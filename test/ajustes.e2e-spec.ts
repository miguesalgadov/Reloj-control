import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Client } from 'pg';
import request = require('supertest');
import { createTestApp } from './setup/test-app';
import { resetTestDatabase } from './setup/test-database';
import { setPasswordForUsers, PASSWORD_DEMO } from './setup/test-users';

// ── Seed IDs ─────────────────────────────────────────────────────────────────
const ADMIN_A_EMAIL   = 'admin@constructoradelsur.cl';
const JUAN_EMAIL      = 'juan.perez@constructoradelsur.cl';
const ADMIN_B_EMAIL   = 'admin@innovadx.cl';

const TENANT_A        = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CENTRO_A        = 'a1111111-1111-1111-1111-111111111111';
const JUAN_TRAB_ID    = 'a4444444-4444-4444-4444-444444444444';
const ANDREA_TRAB_ID  = 'b4444444-4444-4444-4444-444444444444'; // tenant B

// ── Constantes de test ────────────────────────────────────────────────────────
const MOTIVO_OK  = 'El trabajador olvidó registrar su entrada por fallo temporal del sistema.';
const GEO_DENTRO = { latitud: -36.827, longitud: -73.0498, precisionMetros: 5 };

function testDbUrl(): string {
  const url = process.env.TEST_MIGRATION_DATABASE_URL;
  if (!url) throw new Error('TEST_MIGRATION_DATABASE_URL no definida');
  return url;
}

/** Fecha local Santiago N días atrás, hora 08:00. */
function tsSantiago(daysBack = 1): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysBack);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}T08:00:00`;
}

/** Día 15 del mes anterior a hoy (UTC). Siempre < 60 días atrás si estamos en el mes ≤ 75. */
function tsMesAnterior(): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}-15T08:00:00`;
}

/** 65 días atrás — supera el límite de 60. */
function tsExcedePlazo(): string {
  return tsSantiago(65);
}

// ── Suite ─────────────────────────────────────────────────────────────────────
describe('POST /api/ajustes (e2e)', () => {
  let app: INestApplication;
  let httpServer: ReturnType<INestApplication['getHttpServer']>;

  let tokenAdmin: string;
  let tokenJuan: string;        // trabajador
  let tokenAdminB: string;
  let tokenSupervisor: string;

  /** ID de una marcación de Juan creada en beforeAll para usar en corrección/anulación. */
  let marcacionJuanId: string;

  beforeAll(async () => {
    await resetTestDatabase();
    await setPasswordForUsers();
    ({ app, httpServer } = await createTestApp());

    // Tokens por login
    const resAdmin = await request(httpServer)
      .post('/api/auth/login')
      .send({ email: ADMIN_A_EMAIL, password: PASSWORD_DEMO });
    tokenAdmin = resAdmin.body.accessToken;

    const resJuan = await request(httpServer)
      .post('/api/auth/login')
      .send({ email: JUAN_EMAIL, password: PASSWORD_DEMO });
    tokenJuan = resJuan.body.accessToken;

    const resAdminB = await request(httpServer)
      .post('/api/auth/login')
      .send({ email: ADMIN_B_EMAIL, password: PASSWORD_DEMO });
    tokenAdminB = resAdminB.body.accessToken;

    // Token de supervisor generado vía JwtService (no hay supervisor en el seed)
    const jwtService = app.get(JwtService);
    tokenSupervisor = await jwtService.signAsync({
      sub: 'a2222222-2222-2222-2222-222222222222',
      tenantId: TENANT_A,
      rol: 'supervisor',
      trabajadorId: null,
    });

    // Crear una marcación de Juan para tests de corrección/anulación
    const resMar = await request(httpServer)
      .post('/api/marcaciones')
      .set('Authorization', `Bearer ${tokenJuan}`)
      .send({ tipo: 'entrada', fuente: 'web', centroTrabajoId: CENTRO_A, ...GEO_DENTRO });
    marcacionJuanId = resMar.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  // ── Autenticación y autorización ────────────────────────────────────────────

  it('401 sin token', async () => {
    const res = await request(httpServer)
      .post('/api/ajustes')
      .send({ tipo_ajuste: 'creacion', trabajador_id: JUAN_TRAB_ID, motivo: MOTIVO_OK, tipo_marcacion: 'entrada', timestamp_local: tsSantiago() });
    expect(res.status).toBe(401);
  });

  it('403 con token de supervisor', async () => {
    const res = await request(httpServer)
      .post('/api/ajustes')
      .set('Authorization', `Bearer ${tokenSupervisor}`)
      .send({ tipo_ajuste: 'creacion', trabajador_id: JUAN_TRAB_ID, motivo: MOTIVO_OK, tipo_marcacion: 'entrada', timestamp_local: tsSantiago() });
    expect(res.status).toBe(403);
  });

  it('403 con token de trabajador', async () => {
    const res = await request(httpServer)
      .post('/api/ajustes')
      .set('Authorization', `Bearer ${tokenJuan}`)
      .send({ tipo_ajuste: 'creacion', trabajador_id: JUAN_TRAB_ID, motivo: MOTIVO_OK, tipo_marcacion: 'entrada', timestamp_local: tsSantiago() });
    expect(res.status).toBe(403);
  });

  // ── Validaciones de DTO ─────────────────────────────────────────────────────

  it('[aju-2] POST creacion sin motivo → 400', async () => {
    const res = await request(httpServer)
      .post('/api/ajustes')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ tipo_ajuste: 'creacion', trabajador_id: JUAN_TRAB_ID, tipo_marcacion: 'entrada', timestamp_local: tsSantiago() });
    expect(res.status).toBe(400);
  });

  it('[aju-3] POST creacion con motivo de 25 chars → 400', async () => {
    const res = await request(httpServer)
      .post('/api/ajustes')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ tipo_ajuste: 'creacion', trabajador_id: JUAN_TRAB_ID, motivo: 'x'.repeat(25), tipo_marcacion: 'entrada', timestamp_local: tsSantiago() });
    expect(res.status).toBe(400);
    expect(res.body.message).toEqual(
      expect.arrayContaining([expect.stringContaining('30 caracteres')]),
    );
  });

  // ── Validaciones de negocio ─────────────────────────────────────────────────

  it('[aju-5] POST con timestamp > 60 días atrás → 400', async () => {
    const res = await request(httpServer)
      .post('/api/ajustes')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ tipo_ajuste: 'creacion', trabajador_id: JUAN_TRAB_ID, motivo: MOTIVO_OK, tipo_marcacion: 'entrada', timestamp_local: tsExcedePlazo() });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('60 días');
  });

  it('[aju-6] POST sobre mes anterior sin confirmacion_mes_cerrado → 400', async () => {
    const res = await request(httpServer)
      .post('/api/ajustes')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ tipo_ajuste: 'creacion', trabajador_id: JUAN_TRAB_ID, motivo: MOTIVO_OK, tipo_marcacion: 'entrada', timestamp_local: tsMesAnterior(), confirmacion_mes_cerrado: false });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('mes anterior');
  });

  it('[aju-7] POST sobre mes anterior con confirmacion_mes_cerrado → 201', async () => {
    const res = await request(httpServer)
      .post('/api/ajustes')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ tipo_ajuste: 'creacion', trabajador_id: JUAN_TRAB_ID, motivo: MOTIVO_OK, tipo_marcacion: 'salida', timestamp_local: tsMesAnterior(), confirmacion_mes_cerrado: true });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.tipo_ajuste).toBe('creacion');
  });

  // ── Happy paths ─────────────────────────────────────────────────────────────

  it('[aju-1] POST creacion con todos los campos → 201', async () => {
    const res = await request(httpServer)
      .post('/api/ajustes')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        tipo_ajuste: 'creacion',
        trabajador_id: JUAN_TRAB_ID,
        motivo: MOTIVO_OK,
        tipo_marcacion: 'inicio_colacion',
        timestamp_local: tsSantiago(2),
        latitud: -36.827,
        longitud: -73.0498,
        confirmacion_mes_cerrado: false,
      });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.tipo_ajuste).toBe('creacion');
    expect(res.body.tipo_marcacion).toBe('inicio_colacion');
    expect(res.body.trabajador_id).toBe(JUAN_TRAB_ID);
    expect(res.body.motivo).toBe(MOTIVO_OK);
    expect(res.body.creado_por.id).toBeDefined();
  });

  it('POST correccion happy path → 201', async () => {
    const res = await request(httpServer)
      .post('/api/ajustes')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        tipo_ajuste: 'correccion',
        trabajador_id: JUAN_TRAB_ID,
        marcacion_original_id: marcacionJuanId,
        motivo: 'El trabajador marcó tarde por demora en apertura del sistema.',
        timestamp_local_corregido: tsSantiago(1),
      });
    expect(res.status).toBe(201);
    expect(res.body.tipo_ajuste).toBe('correccion');
    expect(res.body.marcacion_original_id).toBe(marcacionJuanId);
  });

  // ── Aislamiento y auditoría ─────────────────────────────────────────────────

  it('[aju-4] POST correccion sobre marcación ya anulada → 404', async () => {
    // Crear una marcación fresca de Juan
    const resMar = await request(httpServer)
      .post('/api/marcaciones')
      .set('Authorization', `Bearer ${tokenJuan}`)
      .send({ tipo: 'fin_colacion', fuente: 'web', centroTrabajoId: CENTRO_A, ...GEO_DENTRO });
    const idParaAnular = resMar.body.id;

    // Anularla
    await request(httpServer)
      .post('/api/ajustes')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ tipo_ajuste: 'anulacion', trabajador_id: JUAN_TRAB_ID, marcacion_original_id: idParaAnular, motivo: 'Marcación duplicada por doble click accidental del trabajador en el sistema.' });

    // Intentar corregir la ya anulada
    const res = await request(httpServer)
      .post('/api/ajustes')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ tipo_ajuste: 'correccion', trabajador_id: JUAN_TRAB_ID, marcacion_original_id: idParaAnular, timestamp_local_corregido: tsSantiago(1), motivo: MOTIVO_OK });
    expect(res.status).toBe(404);
    expect(res.body.message).toContain('anulada');
  });

  it('[aju-13] admin tenant A intenta ajustar trabajador de tenant B → 404', async () => {
    const res = await request(httpServer)
      .post('/api/ajustes')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ tipo_ajuste: 'creacion', trabajador_id: ANDREA_TRAB_ID, motivo: MOTIVO_OK, tipo_marcacion: 'entrada', timestamp_local: tsSantiago() });
    expect(res.status).toBe(404);
  });

  it('[aju-14] audit_log registra evento con categoría marcacion_ajustada', async () => {
    // Crear un ajuste
    const resAjuste = await request(httpServer)
      .post('/api/ajustes')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ tipo_ajuste: 'creacion', trabajador_id: JUAN_TRAB_ID, motivo: MOTIVO_OK, tipo_marcacion: 'salida', timestamp_local: tsSantiago(3) });
    expect(resAjuste.status).toBe(201);
    const ajusteId = resAjuste.body.id;

    // Verificar en audit_log
    const client = new Client({ connectionString: testDbUrl() });
    await client.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE admin_migrate');
      const { rows } = await client.query(
        `SELECT * FROM rc.audit_log
          WHERE entidad_id = $1::uuid
            AND categoria = 'marcacion_ajustada'`,
        [ajusteId],
      );
      await client.query('ROLLBACK');
      expect(rows).toHaveLength(1);
      expect(rows[0].accion).toBe('crear_ajuste');
      expect(rows[0].payload.motivo).toBe(MOTIVO_OK);
    } finally {
      await client.end();
    }
  });

  it('[aju-15] verificar_cadena_hash sigue verde tras varios ajustes encadenados', async () => {
    // Crear 3 ajustes más sobre Juan
    for (let i = 4; i <= 6; i++) {
      await request(httpServer)
        .post('/api/ajustes')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ tipo_ajuste: 'creacion', trabajador_id: JUAN_TRAB_ID, motivo: MOTIVO_OK, tipo_marcacion: 'entrada', timestamp_local: tsSantiago(i) });
    }

    // Verificar integridad de la cadena hash
    const client = new Client({ connectionString: testDbUrl() });
    await client.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE admin_migrate');
      const { rows } = await client.query(
        `SELECT * FROM rc.verificar_cadena_hash($1::uuid)`,
        [TENANT_A],
      );
      await client.query('ROLLBACK');
      // 0 filas = sin corrupción
      expect(rows).toHaveLength(0);
    } finally {
      await client.end();
    }
  });
});
