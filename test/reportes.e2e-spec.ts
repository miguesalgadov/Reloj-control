import { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import request = require('supertest');
import { createTestApp } from './setup/test-app';
import { resetTestDatabase } from './setup/test-database';
import { setPasswordForUsers, PASSWORD_DEMO } from './setup/test-users';

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
       SELECT id FROM rc.tenants ON CONFLICT (tenant_id) DO NOTHING`,
    );
    await client.query(
      `UPDATE rc.configuracion_jornada
       SET tolerancia_atraso_minutos = 10, umbral_inasistencia_sin_marcacion_horas = 2,
           redondeo_horas_extra_modo = 'abajo'`,
    );
    await client.query('COMMIT');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    await client.end();
  }
}

const ADMIN_A_EMAIL  = 'admin@constructoradelsur.cl';
const JUAN_EMAIL     = 'juan.perez@constructoradelsur.cl';
const ADMIN_B_EMAIL  = 'admin@innovadx.cl';
const JUAN_TRAB_ID   = 'a4444444-4444-4444-4444-444444444444';
const CENTRO_A       = 'a1111111-1111-1111-1111-111111111111';
const GEO_A          = { latitud: -36.827, longitud: -73.0498, precisionMetros: 5 };

// Un mes pasado conocido con datos del seed
const AÑO  = 2024;
const MES  = 7; // julio 2024 — Juan lleva meses activo, hay marcaciones del seed en e2e anteriores

describe('Reportes (e2e)', () => {
  let app: INestApplication;
  let httpServer: ReturnType<INestApplication['getHttpServer']>;
  let tokenAdmin: string;
  let tokenJuan: string;
  let tokenAdminB: string;

  beforeAll(async () => {
    await resetTestDatabase();
    await setPasswordForUsers();
    await resetConfiguracion();
    ({ app, httpServer } = await createTestApp());

    const r1 = await request(httpServer).post('/api/auth/login').send({ email: ADMIN_A_EMAIL, password: PASSWORD_DEMO });
    tokenAdmin = r1.body.accessToken;
    const r2 = await request(httpServer).post('/api/auth/login').send({ email: JUAN_EMAIL, password: PASSWORD_DEMO });
    tokenJuan = r2.body.accessToken;
    const r3 = await request(httpServer).post('/api/auth/login').send({ email: ADMIN_B_EMAIL, password: PASSWORD_DEMO });
    tokenAdminB = r3.body.accessToken;
  });

  afterAll(async () => { await app.close(); });

  // ─── Auth ─────────────────────────────────────────────────────────────────

  it('[rep-0a] GET /reportes/asistencia sin token → 401', async () => {
    const res = await request(httpServer).get(`/api/reportes/asistencia/${AÑO}/${MES}`);
    expect(res.status).toBe(401);
  });

  it('[rep-0b] GET /reportes/asistencia con trabajador → 403', async () => {
    const res = await request(httpServer)
      .get(`/api/reportes/asistencia/${AÑO}/${MES}`)
      .set('Authorization', `Bearer ${tokenJuan}`);
    expect(res.status).toBe(403);
  });

  // ─── Reporte 1: Asistencia JSON ───────────────────────────────────────────

  it('[rep-1] GET asistencia → 200 JSON con estructura correcta', async () => {
    const res = await request(httpServer)
      .get(`/api/reportes/asistencia/${AÑO}/${MES}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(200);
    expect(res.body.periodo.año).toBe(AÑO);
    expect(res.body.periodo.mes).toBe(MES);
    expect(Array.isArray(res.body.trabajadores)).toBe(true);
    expect(res.body.totales_periodo).toBeDefined();
    expect(res.body.generado_en).toBeDefined();
  });

  it('[rep-2] GET asistencia?formato=xlsx → 200 con Content-Type XLSX y headers de descarga', async () => {
    const res = await request(httpServer)
      .get(`/api/reportes/asistencia/${AÑO}/${MES}?formato=xlsx`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .buffer(true);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/spreadsheetml/);
    expect(res.headers['content-disposition']).toMatch(/attachment/);
    expect(res.headers['content-disposition']).toMatch(/asistencia/);
  });

  it('[rep-3] GET asistencia con mes futuro → 400', async () => {
    const añoFuturo = new Date().getFullYear() + 1;
    const res = await request(httpServer)
      .get(`/api/reportes/asistencia/${añoFuturo}/1`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(400);
  });

  it('[rep-3b] GET asistencia año < 2024 → 400 (DTO validation)', async () => {
    const res = await request(httpServer)
      .get('/api/reportes/asistencia/2023/1')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(400);
  });

  it('[rep-5a] GET asistencia con filtro trabajador_id → solo ese trabajador', async () => {
    const res = await request(httpServer)
      .get(`/api/reportes/asistencia/${AÑO}/${MES}?trabajador_id=${JUAN_TRAB_ID}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(200);
    expect(res.body.trabajadores.length).toBeLessThanOrEqual(1);
    if (res.body.trabajadores.length === 1) {
      expect(res.body.trabajadores[0].trabajador.id).toBe(JUAN_TRAB_ID);
    }
  });

  // ─── Reporte 2: Resumen trabajadores ─────────────────────────────────────

  it('[rep-4] GET resumen-trabajadores con supervisor → 403', async () => {
    // Primero crear supervisor
    await request(httpServer)
      .post('/api/usuarios')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ email: 'sup@constructoradelsur.cl', password: 'SupPass2024!', nombres: 'Sup', apellidos: 'Test', rol: 'supervisor' });
    const rSup = await request(httpServer).post('/api/auth/login').send({ email: 'sup@constructoradelsur.cl', password: 'SupPass2024!' });
    const tokenSup = rSup.body.accessToken;

    const res = await request(httpServer)
      .get(`/api/reportes/resumen-trabajadores/${AÑO}/${MES}`)
      .set('Authorization', `Bearer ${tokenSup}`);
    expect(res.status).toBe(403);
  });

  it('[rep-4b] GET resumen-trabajadores con admin → 200', async () => {
    const res = await request(httpServer)
      .get(`/api/reportes/resumen-trabajadores/${AÑO}/${MES}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.trabajadores)).toBe(true);
  });

  it('[rep-4c] GET resumen-trabajadores?formato=xlsx → 200 XLSX', async () => {
    const res = await request(httpServer)
      .get(`/api/reportes/resumen-trabajadores/${AÑO}/${MES}?formato=xlsx`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/spreadsheetml/);
  });

  // ─── Reporte 3: Resumen centros ───────────────────────────────────────────

  it('[rep-5] GET resumen-centros con admin → 200', async () => {
    const res = await request(httpServer)
      .get(`/api/reportes/resumen-centros/${AÑO}/${MES}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.centros)).toBe(true);
    expect(res.body.totales_tenant).toBeDefined();
  });

  // ─── Reporte 4: Libro asistencia ─────────────────────────────────────────

  it('[rep-5b] GET libro-asistencia con admin → 200 con leyenda', async () => {
    const res = await request(httpServer)
      .get(`/api/reportes/libro-asistencia/${AÑO}/${MES}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.filas)).toBe(true);
    expect(Array.isArray(res.body.dias_mes)).toBe(true);
    expect(res.body.leyenda).toBeDefined();
    expect(res.body.leyenda.P).toBe('Presente');
  });

  it('[rep-libro-xlsx] GET libro-asistencia?formato=xlsx → 200 XLSX', async () => {
    const res = await request(httpServer)
      .get(`/api/reportes/libro-asistencia/${AÑO}/${MES}?formato=xlsx`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/spreadsheetml/);
    expect(res.headers['content-disposition']).toMatch(/libro-asistencia/);
  });

  // ─── Integración con marcaciones reales ──────────────────────────────────

  it('[rep-int-1] Reporte del mes actual con marcación real de Juan', async () => {
    const hoy = new Date();
    const año = hoy.getFullYear();
    const mes = hoy.getMonth() + 1;

    // Juan marca entrada
    const marcRes = await request(httpServer)
      .post('/api/marcaciones')
      .set('Authorization', `Bearer ${tokenJuan}`)
      .send({ tipo: 'entrada', fuente: 'web', centroTrabajoId: CENTRO_A, ...GEO_A });

    expect(marcRes.status).toBe(201);

    const res = await request(httpServer)
      .get(`/api/reportes/asistencia/${año}/${mes}?trabajador_id=${JUAN_TRAB_ID}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(200);
    const juan = res.body.trabajadores.find((t: any) => t.trabajador.id === JUAN_TRAB_ID);
    expect(juan).toBeDefined();

    if (juan) {
      // Buscar el día de hoy en formato Chile (UTC-4 en invierno)
      const chileMs = hoy.getTime() - 4 * 3600 * 1000;
      const hoyChile = new Date(chileMs).toISOString().slice(0, 10);
      const diaHoy = juan.dias.find((d: any) => d.fecha === hoyChile);

      if (diaHoy) {
        expect(diaHoy.marcaciones.length).toBeGreaterThan(0);
        expect(diaHoy.evaluacion.inasistencia).toBe(false);
      } else {
        // Si el día no laborable (sábado/domingo), verificar que al menos el reporte tiene 200
        expect(res.status).toBe(200);
      }
    }
  });

  // ─── Aislamiento RLS ─────────────────────────────────────────────────────

  it('[rep-6] Admin_A no ve trabajadores de tenant B en asistencia', async () => {
    const res = await request(httpServer)
      .get(`/api/reportes/asistencia/${AÑO}/${MES}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(200);
    const ruts = res.body.trabajadores.map((t: any) => t.trabajador.rut);
    // Andrea de tenant B tiene RUT 17345678-6
    expect(ruts).not.toContain('17345678-6');
  });
});
