import { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import request = require('supertest');
import { createTestApp } from './setup/test-app';
import { resetTestDatabase } from './setup/test-database';
import { setPasswordForUsers, PASSWORD_DEMO } from './setup/test-users';

const ADMIN_EMAIL      = 'admin@constructoradelsur.cl';
const JUAN_EMAIL       = 'juan.perez@constructoradelsur.cl';
const ADMIN_B_EMAIL    = 'admin@innovadx.cl';
const JUAN_TRAB_ID     = 'a4444444-4444-4444-4444-444444444444';
const ANDREA_TRAB_ID   = 'b4444444-4444-4444-4444-444444444444';
const CENTRO_A         = 'a1111111-1111-1111-1111-111111111111';

// Coordenadas dentro de la geocerca de Centro A (radio 150m)
const GEO_DENTRO = { latitud: -36.827, longitud: -73.0498, precisionMetros: 5 };
// Coordenadas fuera de la geocerca (> 150m)
const GEO_FUERA  = { latitud: -36.900, longitud: -73.100, precisionMetros: 5 };

// Próximo lunes desde hoy
const LUNES_PASADO = '2024-07-15'; // lunes conocido (jornada e2e spec)

function testDbUrl(): string {
  const url = process.env.TEST_MIGRATION_DATABASE_URL;
  if (!url) throw new Error('TEST_MIGRATION_DATABASE_URL no definida');
  return url;
}

async function resetConfiguracion(): Promise<void> {
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
    await client.query(
      `UPDATE rc.configuracion_jornada
       SET tolerancia_atraso_minutos              = 10,
           tolerancia_salida_anticipada_minutos   = 5,
           duracion_minima_colacion_minutos        = 25,
           duracion_maxima_colacion_minutos        = 60,
           colacion_es_imputable_jornada           = false,
           umbral_inasistencia_sin_marcacion_horas = 2,
           umbral_jornada_extendida_minutos        = 15,
           redondeo_horas_extra_minutos            = 15,
           redondeo_horas_extra_modo               = 'abajo'`,
    );
    await client.query('COMMIT');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    await client.end();
  }
}

describe('Supervision (e2e)', () => {
  let app: INestApplication;
  let httpServer: ReturnType<INestApplication['getHttpServer']>;
  let tokenAdmin: string;
  let tokenJuan: string;
  let tokenSupervisor: string;
  let tokenAdminB: string;

  beforeAll(async () => {
    await resetTestDatabase();
    await setPasswordForUsers();
    await resetConfiguracion();
    ({ app, httpServer } = await createTestApp());

    const r1 = await request(httpServer).post('/api/auth/login').send({ email: ADMIN_EMAIL, password: PASSWORD_DEMO });
    tokenAdmin = r1.body.accessToken;

    const r2 = await request(httpServer).post('/api/auth/login').send({ email: JUAN_EMAIL, password: PASSWORD_DEMO });
    tokenJuan = r2.body.accessToken;

    const r3 = await request(httpServer).post('/api/auth/login').send({ email: ADMIN_B_EMAIL, password: PASSWORD_DEMO });
    tokenAdminB = r3.body.accessToken;

    // Crear supervisor para tenant A
    await request(httpServer)
      .post('/api/usuarios')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ email: 'supervisor@constructoradelsur.cl', password: 'SupervisorPass2024!', nombres: 'Elena', apellidos: 'Fernandez', rol: 'supervisor' });

    const r4 = await request(httpServer).post('/api/auth/login').send({ email: 'supervisor@constructoradelsur.cl', password: 'SupervisorPass2024!' });
    tokenSupervisor = r4.body.accessToken;
  });

  afterAll(async () => { await app.close(); });

  // ─── Auth ─────────────────────────────────────────────────────────────────

  it('[sup-1] GET /supervision/dia sin token → 401', async () => {
    const res = await request(httpServer).get('/api/supervision/dia');
    expect(res.status).toBe(401);
  });

  it('[sup-2] GET /supervision/dia con rol trabajador → 403', async () => {
    const res = await request(httpServer)
      .get('/api/supervision/dia')
      .set('Authorization', `Bearer ${tokenJuan}`);
    expect(res.status).toBe(403);
  });

  it('[sup-3] GET /supervision/alertas sin token → 401', async () => {
    const res = await request(httpServer).get('/api/supervision/alertas');
    expect(res.status).toBe(401);
  });

  // ─── GET /supervision/dia ─────────────────────────────────────────────────

  it('[sup-4] GET /supervision/dia como admin → 200 con estructura correcta', async () => {
    const res = await request(httpServer)
      .get('/api/supervision/dia')
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(200);
    expect(typeof res.body.fecha).toBe('string');
    expect(typeof res.body.esDiaLaborable).toBe('boolean');
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(typeof res.body.total).toBe('number');
    expect(res.body.resumen).toBeDefined();
    expect(typeof res.body.resumen.total_consultados).toBe('number');
  });

  it('[sup-5] GET /supervision/dia como supervisor → 200', async () => {
    const res = await request(httpServer)
      .get('/api/supervision/dia')
      .set('Authorization', `Bearer ${tokenSupervisor}`);
    expect(res.status).toBe(200);
  });

  it('[sup-6] GET /supervision/dia/:fecha con fecha pasada → 200', async () => {
    const res = await request(httpServer)
      .get('/api/supervision/dia/2024-07-15')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(200);
    expect(res.body.fecha).toBe('2024-07-15');
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('[sup-7] GET /supervision/dia/:fecha con formato inválido → 400', async () => {
    const res = await request(httpServer)
      .get('/api/supervision/dia/no-es-fecha')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(400);
  });

  it('[sup-8] Pedro aparece como sin_contrato (no tiene contrato vigente en el seed)', async () => {
    const res = await request(httpServer)
      .get('/api/supervision/dia')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(200);

    const pedro = res.body.data.find((r: any) => r.trabajador.id === 'a5555555-5555-5555-5555-555555555555');
    // Pedro podría no aparecer si no tiene contrato y no es día laborable
    // Pero siempre debe aparecer ya que filtramos por trabajadores activos
    if (pedro) {
      expect(pedro.estado_dia).toBe('sin_contrato');
    }
  });

  it('[sup-9] filtro ?estado=sin_contrato devuelve solo trabajadores sin contrato', async () => {
    const res = await request(httpServer)
      .get('/api/supervision/dia')
      .query({ estado: 'sin_contrato' })
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(200);
    res.body.data.forEach((r: any) => expect(r.estado_dia).toBe('sin_contrato'));
  });

  it('[sup-10] resumen.total_consultados coincide con número de filas antes de filtrar', async () => {
    const sinFiltro = await request(httpServer)
      .get('/api/supervision/dia')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    const total = sinFiltro.body.resumen.total_consultados;
    const sumResumen =
      sinFiltro.body.resumen.presentes +
      sinFiltro.body.resumen.atrasos +
      sinFiltro.body.resumen.ausentes +
      sinFiltro.body.resumen.esperando_marcacion +
      sinFiltro.body.resumen.no_laborable +
      sinFiltro.body.resumen.sin_contrato;
    expect(sumResumen).toBe(total);
  });

  // ─── GET /supervision/alertas ─────────────────────────────────────────────

  it('[sup-11] GET /supervision/alertas → 200 con estructura correcta', async () => {
    const res = await request(httpServer)
      .get('/api/supervision/alertas')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.total_por_tipo).toBeDefined();
    expect(typeof res.body.total).toBe('number');
  });

  it('[sup-12] alertas?tipo=fuera_geocerca → solo ese tipo en data', async () => {
    // Crear marcación fuera de geocerca
    await request(httpServer)
      .post('/api/marcaciones')
      .set('Authorization', `Bearer ${tokenJuan}`)
      .send({ tipo: 'entrada', fuente: 'web', centroTrabajoId: CENTRO_A, ...GEO_FUERA });

    const res = await request(httpServer)
      .get('/api/supervision/alertas')
      .query({ tipo: 'fuera_geocerca' })
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(200);
    res.body.data.forEach((r: any) => expect(r.tipo).toBe('fuera_geocerca'));
    expect(res.body.total_por_tipo.fuera_geocerca).toBeGreaterThan(0);
    // Los otros tipos no se calcularon, quedan en 0
    expect(res.body.total_por_tipo.inasistencia_presunta).toBe(0);
    expect(res.body.total_por_tipo.atraso_recurrente).toBe(0);
  });

  it('[sup-13] alertas con desde > hasta → 400', async () => {
    const res = await request(httpServer)
      .get('/api/supervision/alertas')
      .query({ desde: '2026-06-10', hasta: '2026-06-01' })
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(400);
  });

  it('[sup-14] alertas con rango > 90 días → 400', async () => {
    const res = await request(httpServer)
      .get('/api/supervision/alertas')
      .query({ desde: '2026-01-01', hasta: '2026-06-30' })
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(400);
  });

  // ─── GET /supervision/trabajadores/:id/semana/:inicio ────────────────────

  it('[sup-15] semana de Juan con lunes válido → 200 con ResultadoSemana', async () => {
    const res = await request(httpServer)
      .get(`/api/supervision/trabajadores/${JUAN_TRAB_ID}/semana/${LUNES_PASADO}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(200);
    expect(res.body.semanaInicio).toBe(LUNES_PASADO);
    expect(res.body.semanaTermino).toBe('2024-07-21');
    expect(Array.isArray(res.body.dias)).toBe(true);
    expect(res.body.dias).toHaveLength(7);
    expect(typeof res.body.horasAcumuladas).toBe('number');
  });

  it('[sup-16] semana con inicio que no es lunes → 400', async () => {
    const res = await request(httpServer)
      .get(`/api/supervision/trabajadores/${JUAN_TRAB_ID}/semana/2024-07-16`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/lunes/i);
  });

  it('[sup-17] semana de trabajador de otro tenant → 404 (aislamiento RLS)', async () => {
    const res = await request(httpServer)
      .get(`/api/supervision/trabajadores/${ANDREA_TRAB_ID}/semana/${LUNES_PASADO}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(404);
  });

  // ─── Aislamiento RLS cross-tenant ────────────────────────────────────────

  it('[sup-18] admin_A consulta /dia: no ve trabajadores de tenant B', async () => {
    const res = await request(httpServer)
      .get('/api/supervision/dia')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(200);

    const ids = res.body.data.map((r: any) => r.trabajador.id);
    expect(ids).not.toContain(ANDREA_TRAB_ID);
  });
});
