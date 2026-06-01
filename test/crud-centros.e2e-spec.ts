import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createTestApp } from './setup/test-app';
import { resetTestDatabase } from './setup/test-database';
import { setPasswordForUsers, PASSWORD_DEMO } from './setup/test-users';

const ADMIN_A_EMAIL = 'admin@constructoradelsur.cl';
const JUAN_EMAIL    = 'juan.perez@constructoradelsur.cl';
const CENTRO_A      = 'a1111111-1111-1111-1111-111111111111'; // tiene a Pedro Soto activo

describe('CRUD Centros de trabajo (e2e)', () => {
  let app: INestApplication;
  let httpServer: ReturnType<INestApplication['getHttpServer']>;
  let tokenAdmin: string;
  let tokenJuan: string;
  let centroNuevoId: string;

  beforeAll(async () => {
    await resetTestDatabase();
    await setPasswordForUsers();
    ({ app, httpServer } = await createTestApp());

    const r1 = await request(httpServer).post('/api/auth/login').send({ email: ADMIN_A_EMAIL, password: PASSWORD_DEMO });
    tokenAdmin = r1.body.accessToken;

    const r2 = await request(httpServer).post('/api/auth/login').send({ email: JUAN_EMAIL, password: PASSWORD_DEMO });
    tokenJuan = r2.body.accessToken;
  });

  afterAll(async () => { await app.close(); });

  // ─── Read-only ────────────────────────────────────────────────────────────

  it('[cen-1] GET /api/centros — admin recibe lista paginada con lat/lng', async () => {
    const res = await request(httpServer)
      .get('/api/centros')
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data[0]).toHaveProperty('latitud');
    expect(res.body.data[0]).toHaveProperty('longitud');
    expect(res.body.data[0]).toHaveProperty('radio_metros');
  });

  it('[cen-2] GET /api/centros — trabajador recibe 403', async () => {
    const res = await request(httpServer)
      .get('/api/centros')
      .set('Authorization', `Bearer ${tokenJuan}`);
    expect(res.status).toBe(403);
  });

  it('[cen-3] GET /api/centros — sin token recibe 401', async () => {
    const res = await request(httpServer).get('/api/centros');
    expect(res.status).toBe(401);
  });

  it('[cen-4] GET /api/centros/:id — detalle del centro', async () => {
    const res = await request(httpServer)
      .get(`/api/centros/${CENTRO_A}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(CENTRO_A);
    expect(typeof res.body.latitud).toBe('number');
    expect(typeof res.body.longitud).toBe('number');
  });

  it('[cen-5] GET /api/centros/:id — 404 para UUID inexistente', async () => {
    const res = await request(httpServer)
      .get('/api/centros/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(404);
  });

  // ─── Mutaciones ───────────────────────────────────────────────────────────

  it('[cen-6] POST /api/centros — admin crea centro (201)', async () => {
    const res = await request(httpServer)
      .post('/api/centros')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        nombre: 'Bodega Central Sur',
        direccion: 'Ruta 5 Sur km 480',
        comuna: 'Temuco',
        region: 'La Araucania',
        latitud: -38.7359,
        longitud: -72.5904,
        radio_metros: 200,
      });

    expect(res.status).toBe(201);
    expect(res.body.nombre).toBe('Bodega Central Sur');
    expect(res.body.estado).toBe('activo');
    expect(typeof res.body.latitud).toBe('number');
    centroNuevoId = res.body.id;
  });

  it('[cen-7] PATCH /api/centros/:id — actualiza datos', async () => {
    const res = await request(httpServer)
      .patch(`/api/centros/${centroNuevoId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ radio_metros: 300 });
    expect(res.status).toBe(200);
    expect(res.body.radio_metros).toBe(300);
  });

  it('[crud-5] POST /api/centros/:id/inactivar — 400 si hay trabajadores activos', async () => {
    // Centro A tiene a Pedro Soto activo asignado
    const res = await request(httpServer)
      .post(`/api/centros/${CENTRO_A}/inactivar`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ motivo: 'Intento de inactivacion bloqueado' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/trabajador/i);
  });

  it('[cen-8] POST /api/centros/:id/inactivar — 200 si no hay trabajadores activos', async () => {
    const res = await request(httpServer)
      .post(`/api/centros/${centroNuevoId}/inactivar`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ motivo: 'Centro sin trabajadores, inactivacion correcta en test' });
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('inactivo');
  });
});
