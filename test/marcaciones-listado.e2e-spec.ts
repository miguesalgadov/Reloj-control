import { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import request = require('supertest');
import { createTestApp } from './setup/test-app';
import { resetTestDatabase } from './setup/test-database';
import { setPasswordForUsers, PASSWORD_DEMO } from './setup/test-users';

const JUAN_EMAIL   = 'juan.perez@constructoradelsur.cl';
const ANDREA_EMAIL = 'andrea.lagos@innovadx.cl';
const TENANT_A     = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CENTRO_A     = 'a1111111-1111-1111-1111-111111111111';
const CENTRO_B     = 'b1111111-1111-1111-1111-111111111111';

const GEO_A = { latitud: -36.827, longitud: -73.0498, precisionMetros: 5 };
const GEO_B = { latitud: -37.4697, longitud: -72.3539, precisionMetros: 5 };

describe('Marcaciones — listado (e2e)', () => {
  let app: INestApplication;
  let httpServer: ReturnType<INestApplication['getHttpServer']>;
  let tokenJuan: string;
  let tokenAndrea: string;

  beforeAll(async () => {
    await resetTestDatabase();
    await setPasswordForUsers();
    ({ app, httpServer } = await createTestApp());

    const resJuan = await request(httpServer)
      .post('/api/auth/login')
      .send({ email: JUAN_EMAIL, password: PASSWORD_DEMO });
    tokenJuan = resJuan.body.accessToken;

    const resAndrea = await request(httpServer)
      .post('/api/auth/login')
      .send({ email: ANDREA_EMAIL, password: PASSWORD_DEMO });
    tokenAndrea = resAndrea.body.accessToken;

    // Crear 3 marcaciones para Juan (Tenant A)
    for (const tipo of ['entrada', 'inicio_colacion', 'fin_colacion'] as const) {
      await request(httpServer)
        .post('/api/marcaciones')
        .set('Authorization', `Bearer ${tokenJuan}`)
        .send({ tipo, fuente: 'web', centroTrabajoId: CENTRO_A, ...GEO_A });
    }

    // Crear 1 marcación para Andrea (Tenant B)
    await request(httpServer)
      .post('/api/marcaciones')
      .set('Authorization', `Bearer ${tokenAndrea}`)
      .send({ tipo: 'entrada', fuente: 'movil', centroTrabajoId: CENTRO_B, ...GEO_B });
  });

  afterAll(async () => {
    await app.close();
  });

  it('[list-1] GET /api/marcaciones/mias con token válido devuelve 200 + array', async () => {
    const res = await request(httpServer)
      .get('/api/marcaciones/mias')
      .set('Authorization', `Bearer ${tokenJuan}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(3);
  });

  it('[list-2] GET /api/marcaciones/mias sin token devuelve 401', async () => {
    const res = await request(httpServer).get('/api/marcaciones/mias');
    expect(res.status).toBe(401);
  });

  it('[list-3] Juan (Tenant A) no ve marcaciones de Andrea (Tenant B) — aislamiento RLS', async () => {
    const [resJuan, resAndrea] = await Promise.all([
      request(httpServer)
        .get('/api/marcaciones/mias')
        .set('Authorization', `Bearer ${tokenJuan}`),
      request(httpServer)
        .get('/api/marcaciones/mias')
        .set('Authorization', `Bearer ${tokenAndrea}`),
    ]);

    expect(resJuan.status).toBe(200);
    expect(resAndrea.status).toBe(200);

    // Todas las marcaciones de Juan son del Tenant A
    for (const marc of resJuan.body) {
      expect(marc.tenant_id).toBe(TENANT_A);
    }

    // Los IDs de Andrea no aparecen en la lista de Juan
    const juanIds = new Set(resJuan.body.map((m: { id: string }) => m.id));
    for (const marc of resAndrea.body) {
      expect(juanIds.has(marc.id)).toBe(false);
    }
  });

  it('[list-4] GET /api/marcaciones/mias?limit=2 devuelve máximo 2 resultados', async () => {
    const res = await request(httpServer)
      .get('/api/marcaciones/mias?limit=2')
      .set('Authorization', `Bearer ${tokenJuan}`);

    expect(res.status).toBe(200);
    expect(res.body.length).toBeLessThanOrEqual(2);
  });

  it('[list-5] UPDATE directo como admin_migrate dispara trigger append-only (código 42501)', async () => {
    // El trigger tg_marcaciones_no_update lanza ERRCODE = insufficient_privilege (42501)
    // ante cualquier UPDATE, independientemente del rol.
    // admin_migrate tiene UPDATE privilege, lo que garantiza que es el trigger — no
    // una denegación de permiso — quien levanta el error.
    const client = new Client({ connectionString: process.env.TEST_MIGRATION_DATABASE_URL! });
    await client.connect();

    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE admin_migrate');

      await expect(
        client.query(
          "UPDATE rc.marcaciones SET tipo = 'salida' WHERE tenant_id = $1",
          [TENANT_A],
        ),
      ).rejects.toMatchObject({ code: '42501' });
    } finally {
      try { await client.query('ROLLBACK'); } catch {}
      await client.end();
    }
  });
});
