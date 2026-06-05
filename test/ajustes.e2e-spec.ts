import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Client } from 'pg';
import request = require('supertest');
import { createTestApp } from './setup/test-app';
import { resetTestDatabase } from './setup/test-database';
import { setPasswordForUsers, PASSWORD_DEMO } from './setup/test-users';

// ── Seed IDs ─────────────────────────────────────────────────────────────────
const ADMIN_A_EMAIL  = 'admin@constructoradelsur.cl';
const JUAN_EMAIL     = 'juan.perez@constructoradelsur.cl';
const ADMIN_B_EMAIL  = 'admin@innovadx.cl';

const TENANT_A       = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CENTRO_A       = 'a1111111-1111-1111-1111-111111111111';
const JUAN_TRAB_ID   = 'a4444444-4444-4444-4444-444444444444';
const ANDREA_TRAB_ID = 'b4444444-4444-4444-4444-444444444444'; // tenant B

const MOTIVO_OK  = 'El trabajador olvidó registrar su entrada por fallo temporal del sistema.';
const GEO_DENTRO = { latitud: -36.827, longitud: -73.0498, precisionMetros: 5 };

function testDbUrl(): string {
  const url = process.env.TEST_MIGRATION_DATABASE_URL;
  if (!url) throw new Error('TEST_MIGRATION_DATABASE_URL no definida');
  return url;
}

async function ensureConfiguracionJornada(): Promise<void> {
  const client = new Client({ connectionString: testDbUrl() });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE admin_migrate');
    await client.query(
      `INSERT INTO rc.configuracion_jornada (tenant_id)
       SELECT id FROM rc.tenants
       ON CONFLICT (tenant_id) DO NOTHING`,
    );
    await client.query('COMMIT');
  } finally {
    await client.end();
  }
}

/**
 * Fecha local Santiago N días atrás, hora 08:00.
 * Si la resta cruza al mes anterior, clampea al día 1 del mes actual
 * para evitar que los tests fallen con "mes anterior sin confirmación".
 */
function tsSantiago(daysBack = 1): string {
  const now = new Date();
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - daysBack);
  if (d.getUTCMonth() !== now.getUTCMonth() || d.getUTCFullYear() !== now.getUTCFullYear()) {
    d.setUTCFullYear(now.getUTCFullYear(), now.getUTCMonth(), 1);
  }
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T08:00:00`;
}

/** Día 15 del mes anterior. */
function tsMesAnterior(): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-15T08:00:00`;
}

/** 65 días atrás — supera el límite de 60. No clampea al mes actual. */
function tsExcedePlazo(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 65);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T08:00:00`;
}

// ── Suite principal ───────────────────────────────────────────────────────────
describe('Ajustes API (e2e)', () => {
  let app: INestApplication;
  let httpServer: ReturnType<INestApplication['getHttpServer']>;

  let tokenAdmin: string;
  let tokenJuan: string;
  let tokenAdminB: string;
  let tokenSupervisor: string;

  // Marcaciones de Juan para usar en corrección/anulación
  let marcacionBaseId: string;      // se usa en tests POST (correccion)
  let marcacionParaCorreccion: string; // se usa en beforeAll GET setup
  let marcacionParaAnulacion: string;  // se usa en beforeAll GET setup

  // Ajustes creados en beforeAll para tests de lectura
  let ajusteCreacionId: string;
  let ajusteCorreccionId: string;
  let ajusteAnulacionId: string;

  beforeAll(async () => {
    await resetTestDatabase();
    await setPasswordForUsers();
    await ensureConfiguracionJornada();
    ({ app, httpServer } = await createTestApp());

    // ── Tokens ───────────────────────────────────────────────────────────────
    const resAdmin = await request(httpServer)
      .post('/api/auth/login').send({ email: ADMIN_A_EMAIL, password: PASSWORD_DEMO });
    tokenAdmin = resAdmin.body.accessToken;

    const resJuan = await request(httpServer)
      .post('/api/auth/login').send({ email: JUAN_EMAIL, password: PASSWORD_DEMO });
    tokenJuan = resJuan.body.accessToken;

    const resAdminB = await request(httpServer)
      .post('/api/auth/login').send({ email: ADMIN_B_EMAIL, password: PASSWORD_DEMO });
    tokenAdminB = resAdminB.body.accessToken;

    const jwtService = app.get(JwtService);
    tokenSupervisor = await jwtService.signAsync({
      sub: 'a2222222-2222-2222-2222-222222222222',
      tenantId: TENANT_A,
      rol: 'supervisor',
      trabajadorId: null,
    });

    // ── Marcaciones base ──────────────────────────────────────────────────────
    const mar1 = await request(httpServer)
      .post('/api/marcaciones').set('Authorization', `Bearer ${tokenJuan}`)
      .send({ tipo: 'entrada', fuente: 'web', centroTrabajoId: CENTRO_A, ...GEO_DENTRO });
    marcacionBaseId = mar1.body.id;

    const mar2 = await request(httpServer)
      .post('/api/marcaciones').set('Authorization', `Bearer ${tokenJuan}`)
      .send({ tipo: 'inicio_colacion', fuente: 'web', centroTrabajoId: CENTRO_A, ...GEO_DENTRO });
    marcacionParaCorreccion = mar2.body.id;

    const mar3 = await request(httpServer)
      .post('/api/marcaciones').set('Authorization', `Bearer ${tokenJuan}`)
      .send({ tipo: 'salida', fuente: 'web', centroTrabajoId: CENTRO_A, ...GEO_DENTRO });
    marcacionParaAnulacion = mar3.body.id;

    // ── Ajustes para tests de GET ─────────────────────────────────────────────
    const r1 = await request(httpServer)
      .post('/api/ajustes').set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ tipo_ajuste: 'creacion', trabajador_id: JUAN_TRAB_ID, motivo: MOTIVO_OK, tipo_marcacion: 'fin_colacion', timestamp_local: tsSantiago(2) });
    ajusteCreacionId = r1.body.id;

    const r2 = await request(httpServer)
      .post('/api/ajustes').set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ tipo_ajuste: 'correccion', trabajador_id: JUAN_TRAB_ID, marcacion_original_id: marcacionParaCorreccion, motivo: MOTIVO_OK, timestamp_local_corregido: tsSantiago(1) });
    ajusteCorreccionId = r2.body.id;

    const r3 = await request(httpServer)
      .post('/api/ajustes').set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ tipo_ajuste: 'anulacion', trabajador_id: JUAN_TRAB_ID, marcacion_original_id: marcacionParaAnulacion, motivo: MOTIVO_OK });
    ajusteAnulacionId = r3.body.id;
  });

  afterAll(async () => { await app.close(); });

  // ═══════════════════════════════════════════════════════════════════════════
  // POST /api/ajustes
  // ═══════════════════════════════════════════════════════════════════════════
  describe('POST /api/ajustes', () => {
    it('401 sin token', async () => {
      const res = await request(httpServer).post('/api/ajustes')
        .send({ tipo_ajuste: 'creacion', trabajador_id: JUAN_TRAB_ID, motivo: MOTIVO_OK, tipo_marcacion: 'entrada', timestamp_local: tsSantiago() });
      expect(res.status).toBe(401);
    });

    it('403 supervisor → no puede POST', async () => {
      const res = await request(httpServer).post('/api/ajustes')
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({ tipo_ajuste: 'creacion', trabajador_id: JUAN_TRAB_ID, motivo: MOTIVO_OK, tipo_marcacion: 'entrada', timestamp_local: tsSantiago() });
      expect(res.status).toBe(403);
    });

    it('403 trabajador → no puede POST', async () => {
      const res = await request(httpServer).post('/api/ajustes')
        .set('Authorization', `Bearer ${tokenJuan}`)
        .send({ tipo_ajuste: 'creacion', trabajador_id: JUAN_TRAB_ID, motivo: MOTIVO_OK, tipo_marcacion: 'entrada', timestamp_local: tsSantiago() });
      expect(res.status).toBe(403);
    });

    it('[aju-2] POST creacion sin motivo → 400', async () => {
      const res = await request(httpServer).post('/api/ajustes')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ tipo_ajuste: 'creacion', trabajador_id: JUAN_TRAB_ID, tipo_marcacion: 'entrada', timestamp_local: tsSantiago() });
      expect(res.status).toBe(400);
    });

    it('[aju-3] POST creacion con motivo de 25 chars → 400', async () => {
      const res = await request(httpServer).post('/api/ajustes')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ tipo_ajuste: 'creacion', trabajador_id: JUAN_TRAB_ID, motivo: 'x'.repeat(25), tipo_marcacion: 'entrada', timestamp_local: tsSantiago() });
      expect(res.status).toBe(400);
      expect(res.body.message).toEqual(expect.arrayContaining([expect.stringContaining('30 caracteres')]));
    });

    it('[aju-5] timestamp > 60 días atrás → 400', async () => {
      const res = await request(httpServer).post('/api/ajustes')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ tipo_ajuste: 'creacion', trabajador_id: JUAN_TRAB_ID, motivo: MOTIVO_OK, tipo_marcacion: 'entrada', timestamp_local: tsExcedePlazo() });
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('60 días');
    });

    it('[aju-6] mes anterior sin confirmacion_mes_cerrado → 400', async () => {
      const res = await request(httpServer).post('/api/ajustes')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ tipo_ajuste: 'creacion', trabajador_id: JUAN_TRAB_ID, motivo: MOTIVO_OK, tipo_marcacion: 'entrada', timestamp_local: tsMesAnterior(), confirmacion_mes_cerrado: false });
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('mes anterior');
    });

    it('[aju-7] mes anterior con confirmacion_mes_cerrado → 201', async () => {
      const res = await request(httpServer).post('/api/ajustes')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ tipo_ajuste: 'creacion', trabajador_id: JUAN_TRAB_ID, motivo: MOTIVO_OK, tipo_marcacion: 'salida', timestamp_local: tsMesAnterior(), confirmacion_mes_cerrado: true });
      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
    });

    it('[aju-1] POST creacion con todos los campos → 201', async () => {
      const res = await request(httpServer).post('/api/ajustes')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ tipo_ajuste: 'creacion', trabajador_id: JUAN_TRAB_ID, motivo: MOTIVO_OK, tipo_marcacion: 'inicio_colacion', timestamp_local: tsSantiago(3), latitud: -36.827, longitud: -73.0498 });
      expect(res.status).toBe(201);
      expect(res.body.tipo_ajuste).toBe('creacion');
      expect(res.body.tipo_marcacion).toBe('inicio_colacion');
      expect(res.body.trabajador_id).toBe(JUAN_TRAB_ID);
      expect(res.body.motivo).toBe(MOTIVO_OK);
      expect(res.body.creado_por.id).toBeDefined();
      expect(res.body.creado_por.nombre).not.toBe(res.body.creado_por.id); // nombre resuelto desde DB
    });

    it('POST correccion happy path → 201', async () => {
      const res = await request(httpServer).post('/api/ajustes')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ tipo_ajuste: 'correccion', trabajador_id: JUAN_TRAB_ID, marcacion_original_id: marcacionBaseId, motivo: 'El sistema registró la hora tarde por latencia de red en el servidor.', timestamp_local_corregido: tsSantiago(1) });
      expect(res.status).toBe(201);
      expect(res.body.tipo_ajuste).toBe('correccion');
      expect(res.body.marcacion_original_id).toBe(marcacionBaseId);
    });

    it('[aju-4] correccion sobre marcación ya anulada → 404', async () => {
      // Crear marcación fresca y anularla
      const resMar = await request(httpServer)
        .post('/api/marcaciones').set('Authorization', `Bearer ${tokenJuan}`)
        .send({ tipo: 'fin_colacion', fuente: 'web', centroTrabajoId: CENTRO_A, ...GEO_DENTRO });
      const idFresco = resMar.body.id;

      await request(httpServer).post('/api/ajustes')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ tipo_ajuste: 'anulacion', trabajador_id: JUAN_TRAB_ID, marcacion_original_id: idFresco, motivo: 'Marcación duplicada por doble click accidental en el terminal del trabajador.' });

      const res = await request(httpServer).post('/api/ajustes')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ tipo_ajuste: 'correccion', trabajador_id: JUAN_TRAB_ID, marcacion_original_id: idFresco, timestamp_local_corregido: tsSantiago(1), motivo: MOTIVO_OK });
      expect(res.status).toBe(404);
      expect(res.body.message).toContain('anulada');
    });

    it('[aju-13] admin tenant A ajusta trabajador de tenant B → 404', async () => {
      const res = await request(httpServer).post('/api/ajustes')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ tipo_ajuste: 'creacion', trabajador_id: ANDREA_TRAB_ID, motivo: MOTIVO_OK, tipo_marcacion: 'entrada', timestamp_local: tsSantiago() });
      expect(res.status).toBe(404);
    });

    it('[aju-14] audit_log registra evento con categoría marcacion_ajustada', async () => {
      const resAjuste = await request(httpServer).post('/api/ajustes')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ tipo_ajuste: 'creacion', trabajador_id: JUAN_TRAB_ID, motivo: MOTIVO_OK, tipo_marcacion: 'salida', timestamp_local: tsSantiago(4) });
      expect(resAjuste.status).toBe(201);

      const client = new Client({ connectionString: testDbUrl() });
      await client.connect();
      try {
        await client.query('BEGIN');
        await client.query('SET LOCAL ROLE admin_migrate');
        const { rows } = await client.query(
          `SELECT * FROM rc.audit_log WHERE entidad_id = $1::uuid AND categoria = 'marcacion_ajustada'`,
          [resAjuste.body.id],
        );
        await client.query('ROLLBACK');
        expect(rows).toHaveLength(1);
        expect(rows[0].accion).toBe('crear_ajuste');
        expect(rows[0].payload.motivo).toBe(MOTIVO_OK);
      } finally {
        await client.end();
      }
    });

    it('[aju-15] verificar_cadena_hash verde tras ajustes encadenados', async () => {
      // tsSantiago() ya clampea al mes actual, así que todos son fechas válidas
      for (let i = 1; i <= 3; i++) {
        await request(httpServer).post('/api/ajustes')
          .set('Authorization', `Bearer ${tokenAdmin}`)
          .send({ tipo_ajuste: 'creacion', trabajador_id: JUAN_TRAB_ID, motivo: MOTIVO_OK, tipo_marcacion: 'entrada', timestamp_local: tsSantiago(i) });
      }

      const client = new Client({ connectionString: testDbUrl() });
      await client.connect();
      try {
        await client.query('BEGIN');
        await client.query('SET LOCAL ROLE admin_migrate');
        const { rows } = await client.query(
          `SELECT * FROM rc.verificar_cadena_hash($1::uuid)`, [TENANT_A],
        );
        await client.query('ROLLBACK');
        expect(rows).toHaveLength(0);
      } finally {
        await client.end();
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // [aju-10] Integración: creacion ajuste → jornada del día lo refleja
  // ═══════════════════════════════════════════════════════════════════════════
  describe('[aju-10] creacion → /api/jornadas/:fecha refleja la marcación efectiva', () => {
    it('tras crear ajuste tipo creacion, la jornada del día incluye la marcación', async () => {
      // tsSantiago(1) con clampeo garantiza estar en el mes actual
      const tsAjuste = tsSantiago(1);
      const fechaAjuste = tsAjuste.slice(0, 10); // 'YYYY-MM-DD'

      const resAjuste = await request(httpServer).post('/api/ajustes')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ tipo_ajuste: 'creacion', trabajador_id: JUAN_TRAB_ID, motivo: MOTIVO_OK, tipo_marcacion: 'entrada', timestamp_local: tsAjuste });
      expect(resAjuste.status).toBe(201);
      const ajusteId = resAjuste.body.id;

      // Juan consulta su jornada de ese día
      const resJornada = await request(httpServer)
        .get(`/api/jornadas/${fechaAjuste}`)
        .set('Authorization', `Bearer ${tokenJuan}`);
      expect(resJornada.status).toBe(200);

      // La marcación efectiva (creacion) debe aparecer en marcacionesDelDia
      const ids = (resJornada.body.marcacionesDelDia as any[]).map(m => m.id);
      expect(ids).toContain(ajusteId);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GET /api/ajustes
  // ═══════════════════════════════════════════════════════════════════════════
  describe('GET /api/ajustes', () => {
    it('401 sin token', async () => {
      const res = await request(httpServer).get('/api/ajustes');
      expect(res.status).toBe(401);
    });

    it('403 trabajador → no puede listar', async () => {
      const res = await request(httpServer).get('/api/ajustes')
        .set('Authorization', `Bearer ${tokenJuan}`);
      expect(res.status).toBe(403);
    });

    it('200 admin puede listar → devuelve estructura correcta', async () => {
      const res = await request(httpServer).get('/api/ajustes')
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
      expect(res.body).toHaveProperty('total');
      expect(res.body).toHaveProperty('limit');
      expect(res.body).toHaveProperty('offset');
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.total).toBeGreaterThanOrEqual(3);
    });

    it('200 supervisor puede listar', async () => {
      const res = await request(httpServer).get('/api/ajustes')
        .set('Authorization', `Bearer ${tokenSupervisor}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('[aju-8] filtro tipo_ajuste=correccion → solo correcciones', async () => {
      const res = await request(httpServer).get('/api/ajustes?tipo_ajuste=correccion')
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.data.every((a: any) => a.tipo_ajuste === 'correccion')).toBe(true);
    });

    it('[aju-9] filtro trabajador_id → solo ajustes de ese trabajador', async () => {
      const res = await request(httpServer).get(`/api/ajustes?trabajador_id=${JUAN_TRAB_ID}`)
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.data.every((a: any) => a.trabajador.id === JUAN_TRAB_ID)).toBe(true);
    });

    it('filtro tipo_ajuste=anulacion → solo anulaciones', async () => {
      const res = await request(httpServer).get('/api/ajustes?tipo_ajuste=anulacion')
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.data.every((a: any) => a.tipo_ajuste === 'anulacion')).toBe(true);
    });

    it('filtro tipo_ajuste=creacion → solo creaciones', async () => {
      const res = await request(httpServer).get('/api/ajustes?tipo_ajuste=creacion')
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.data.every((a: any) => a.tipo_ajuste === 'creacion')).toBe(true);
    });

    it('paginación limit=2 → devuelve 2 items y total correcto', async () => {
      const res = await request(httpServer).get('/api/ajustes?limit=2&offset=0')
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(2);
      expect(res.body.limit).toBe(2);
      expect(res.body.offset).toBe(0);
      expect(res.body.total).toBeGreaterThan(2);
    });

    it('aislamiento RLS: admin B no ve ajustes de tenant A', async () => {
      const res = await request(httpServer).get('/api/ajustes')
        .set('Authorization', `Bearer ${tokenAdminB}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0); // tenant B no tiene ajustes
      expect(res.body.total).toBe(0);
    });

    it('estructura de fila incluye todos los campos requeridos', async () => {
      const res = await request(httpServer).get(`/api/ajustes?tipo_ajuste=correccion`)
        .set('Authorization', `Bearer ${tokenAdmin}`);
      const fila = res.body.data[0];
      expect(fila).toHaveProperty('id');
      expect(fila).toHaveProperty('tipo_ajuste');
      expect(fila).toHaveProperty('trabajador');
      expect(fila.trabajador).toHaveProperty('id');
      expect(fila.trabajador).toHaveProperty('rut');
      expect(fila.trabajador).toHaveProperty('nombre_completo');
      expect(fila).toHaveProperty('tipo_marcacion');
      expect(fila).toHaveProperty('motivo');
      expect(fila).toHaveProperty('creado_por');
      expect(fila).toHaveProperty('created_at');
      // tipo_marcacion de una correccion devuelve el tipo real (no 'ajuste')
      expect(fila.tipo_marcacion).not.toBe('ajuste');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GET /api/ajustes/:id
  // ═══════════════════════════════════════════════════════════════════════════
  describe('GET /api/ajustes/:id', () => {
    it('401 sin token', async () => {
      const res = await request(httpServer).get(`/api/ajustes/${ajusteCreacionId}`);
      expect(res.status).toBe(401);
    });

    it('403 trabajador no puede ver detalle', async () => {
      const res = await request(httpServer).get(`/api/ajustes/${ajusteCreacionId}`)
        .set('Authorization', `Bearer ${tokenJuan}`);
      expect(res.status).toBe(403);
    });

    it('200 admin puede ver detalle de creacion (sin marcacion_original_completa)', async () => {
      const res = await request(httpServer).get(`/api/ajustes/${ajusteCreacionId}`)
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(ajusteCreacionId);
      expect(res.body.tipo_ajuste).toBe('creacion');
      expect(res.body.marcacion_original_completa).toBeNull();
      expect(res.body).toHaveProperty('audit_log_id');
      expect(res.body.audit_log_id).toBeTruthy(); // tiene entrada en audit_log
    });

    it('200 detalle de correccion incluye marcacion_original_completa', async () => {
      const res = await request(httpServer).get(`/api/ajustes/${ajusteCorreccionId}`)
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(ajusteCorreccionId);
      expect(res.body.tipo_ajuste).toBe('correccion');
      expect(res.body.marcacion_original_completa).not.toBeNull();
      expect(res.body.marcacion_original_completa.id).toBe(marcacionParaCorreccion);
      expect(res.body.marcacion_original_completa.tipo).toBeDefined();
      expect(res.body.marcacion_original_completa.timestamp_utc).toBeDefined();
      expect(res.body.audit_log_id).toBeTruthy();
    });

    it('200 detalle de anulacion incluye marcacion_original_completa', async () => {
      const res = await request(httpServer).get(`/api/ajustes/${ajusteAnulacionId}`)
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(res.status).toBe(200);
      expect(res.body.tipo_ajuste).toBe('anulacion');
      expect(res.body.marcacion_original_completa).not.toBeNull();
      expect(res.body.marcacion_original_completa.id).toBe(marcacionParaAnulacion);
    });

    it('200 supervisor puede ver detalle', async () => {
      const res = await request(httpServer).get(`/api/ajustes/${ajusteCreacionId}`)
        .set('Authorization', `Bearer ${tokenSupervisor}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(ajusteCreacionId);
    });

    it('404 ID inexistente', async () => {
      const res = await request(httpServer)
        .get('/api/ajustes/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(res.status).toBe(404);
    });

    it('aislamiento RLS: admin B intenta ver ajuste de tenant A → 404', async () => {
      const res = await request(httpServer).get(`/api/ajustes/${ajusteCorreccionId}`)
        .set('Authorization', `Bearer ${tokenAdminB}`);
      expect(res.status).toBe(404);
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// [aju-int-1] Flujo de integración end-to-end
// ═════════════════════════════════════════════════════════════════════════════
describe('[aju-int-1] Flujo completo: olvido → ajuste → presente en todos los sistemas', () => {
  let app2: INestApplication;
  let httpServer2: ReturnType<INestApplication['getHttpServer']>;
  let tokenAdmin2: string;
  let tokenJuan2: string;

  const FECHA = '2026-06-02'; // lunes de junio 2026 — laborable para Juan

  beforeAll(async () => {
    await resetTestDatabase();
    await setPasswordForUsers();
    await ensureConfiguracionJornada();
    ({ app: app2, httpServer: httpServer2 } = await createTestApp());

    const rA = await request(httpServer2).post('/api/auth/login').send({ email: ADMIN_A_EMAIL, password: PASSWORD_DEMO });
    tokenAdmin2 = rA.body.accessToken;
    const rJ = await request(httpServer2).post('/api/auth/login').send({ email: JUAN_EMAIL, password: PASSWORD_DEMO });
    tokenJuan2 = rJ.body.accessToken;
  });

  afterAll(async () => { await app2.close(); });

  it('[aju-int-1] trabajador olvidó marcar → ajuste creacion → presente en evaluador, reporte y supervisión', async () => {
    const hoy = new Date();
    const año = hoy.getFullYear();
    const mes = hoy.getMonth() + 1;

    // ── Paso 1: sin ajuste, supervisión muestra a Juan sin marcaciones ─────
    const resSup1 = await request(httpServer2)
      .get(`/api/supervision/dia/${FECHA}`)
      .set('Authorization', `Bearer ${tokenAdmin2}`);
    expect(resSup1.status).toBe(200);
    const juan1 = resSup1.body.data.find((w: any) => w.trabajador.id === JUAN_TRAB_ID);
    if (juan1) {
      expect(['ausente', 'esperando']).toContain(juan1.estado_dia);
    }

    // ── Paso 2: admin crea ajuste tipo creacion (entrada puntual) ─────────
    const resAjuste = await request(httpServer2)
      .post('/api/ajustes')
      .set('Authorization', `Bearer ${tokenAdmin2}`)
      .send({
        tipo_ajuste: 'creacion',
        trabajador_id: JUAN_TRAB_ID,
        motivo: 'Trabajador olvidó registrar su entrada por fallo en el sistema biométrico.',
        tipo_marcacion: 'entrada',
        timestamp_local: `${FECHA}T08:00:00`,
        confirmacion_mes_cerrado: false,
      });
    expect(resAjuste.status).toBe(201);
    const ajusteId = resAjuste.body.id;
    expect(ajusteId).toBeDefined();

    // ── Paso 3: evaluador del Paso 4 considera al trabajador presente ──────
    const resJornada = await request(httpServer2)
      .get(`/api/jornadas/${FECHA}`)
      .set('Authorization', `Bearer ${tokenJuan2}`);
    expect(resJornada.status).toBe(200);
    expect(resJornada.body.inasistencia.inasistencia).toBe(false);
    expect(resJornada.body.marcacionesDelDia.length).toBeGreaterThan(0);
    expect(resJornada.body.marcacionesDelDia.some((m: any) => m.tipo === 'entrada')).toBe(true);
    const idEnResultado = resJornada.body.marcacionesDelDia.find((m: any) => m.tipo === 'entrada')?.id;
    expect(idEnResultado).toBe(ajusteId);

    // ── Paso 4: supervisión ya no lo muestra como ausente ─────────────────
    const resSup2 = await request(httpServer2)
      .get(`/api/supervision/dia/${FECHA}`)
      .set('Authorization', `Bearer ${tokenAdmin2}`);
    expect(resSup2.status).toBe(200);
    const juan2 = resSup2.body.data.find((w: any) => w.trabajador.id === JUAN_TRAB_ID);
    if (juan2) {
      expect(['presente', 'atraso']).toContain(juan2.estado_dia);
      expect(juan2.ultima_marcacion?.id).toBe(ajusteId);
    }

    // ── Paso 5: reporte del Paso D muestra el día como trabajado ──────────
    const resReporte = await request(httpServer2)
      .get(`/api/reportes/asistencia/${año}/${mes}?trabajador_id=${JUAN_TRAB_ID}`)
      .set('Authorization', `Bearer ${tokenAdmin2}`);
    expect(resReporte.status).toBe(200);
    const diaRep = resReporte.body.trabajadores[0]?.dias.find((d: any) => d.fecha === FECHA);
    if (diaRep?.es_laborable) {
      expect(diaRep.evaluacion.inasistencia).toBe(false);
      expect(diaRep.marcaciones.some((m: any) => m.hora_local === '08:00')).toBe(true);
    }
  });
});
