import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createTestApp } from './setup/test-app';
import { resetTestDatabase } from './setup/test-database';
import { setPasswordForUsers, PASSWORD_DEMO } from './setup/test-users';

const ADMIN_A_EMAIL = 'admin@constructoradelsur.cl';
const JUAN_EMAIL    = 'juan.perez@constructoradelsur.cl';
const JUAN_TRAB_ID  = 'a4444444-4444-4444-4444-444444444444';
const CONTRATO_JUAN = 'a6666666-6666-6666-6666-666666666666';

describe('CRUD Contratos y Jornadas pactadas (e2e)', () => {
  let app: INestApplication;
  let httpServer: ReturnType<INestApplication['getHttpServer']>;
  let tokenAdmin: string;
  let tokenJuan: string;
  let nuevoContratoId: string;

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

  it('[con-1] GET /api/contratos — admin recibe lista paginada', async () => {
    const res = await request(httpServer)
      .get('/api/contratos')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it('[con-2] GET /api/contratos — trabajador recibe 403', async () => {
    const res = await request(httpServer)
      .get('/api/contratos')
      .set('Authorization', `Bearer ${tokenJuan}`);
    expect(res.status).toBe(403);
  });

  it('[con-3] GET /api/contratos/:id — detalle incluye jornadas_pactadas', async () => {
    const res = await request(httpServer)
      .get(`/api/contratos/${CONTRATO_JUAN}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(CONTRATO_JUAN);
    expect(Array.isArray(res.body.jornadas_pactadas)).toBe(true);
    expect(res.body.jornadas_pactadas.length).toBe(5); // L-V del seed
  });

  it('[con-4] GET /api/contratos?trabajador_id=... — filtra por trabajador', async () => {
    const res = await request(httpServer)
      .get(`/api/contratos?trabajador_id=${JUAN_TRAB_ID}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(200);
    res.body.data.forEach((c: { trabajador_id: string }) => expect(c.trabajador_id).toBe(JUAN_TRAB_ID));
  });

  it('[con-5] GET /api/contratos/:id/jornadas — lista jornadas del contrato', async () => {
    const res = await request(httpServer)
      .get(`/api/contratos/${CONTRATO_JUAN}/jornadas`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res)).toBe(false); // es array directo
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(5);
    expect(res.body[0]).toHaveProperty('dia_semana');
    expect(res.body[0]).toHaveProperty('hora_inicio');
  });

  // ─── Mutaciones ───────────────────────────────────────────────────────────

  it('[con-6] POST /api/contratos — 409 si trabajador ya tiene contrato vigente', async () => {
    const res = await request(httpServer)
      .post('/api/contratos')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        trabajador_id: JUAN_TRAB_ID,
        tipo_contrato: 'plazo_fijo',
        cargo: 'Maestro extra',
        fecha_inicio: '2026-01-01',
        fecha_termino: '2026-12-31',
        horas_semanales: 44,
      });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/vigente/i);
  });

  it('[con-7] POST /api/contratos/:id/terminar — termina contrato vigente', async () => {
    const res = await request(httpServer)
      .post(`/api/contratos/${CONTRATO_JUAN}/terminar`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ motivo: 'Finalizacion por reestructuracion organizacional de la constructora' });
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('terminado');
  });

  it('[con-8] POST /api/contratos — crea contrato para Juan (después de terminar el vigente)', async () => {
    const res = await request(httpServer)
      .post('/api/contratos')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        trabajador_id: JUAN_TRAB_ID,
        tipo_contrato: 'indefinido',
        cargo: 'Jefe de obras',
        fecha_inicio: '2026-06-01',
        horas_semanales: 44,
      });
    expect(res.status).toBe(201);
    expect(res.body.estado).toBe('vigente');
    nuevoContratoId = res.body.id;
  });

  it('[con-9] PATCH /api/contratos/:id — actualiza cargo', async () => {
    const res = await request(httpServer)
      .patch(`/api/contratos/${nuevoContratoId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ cargo: 'Supervisor general de obras' });
    expect(res.status).toBe(200);
    expect(res.body.cargo).toBe('Supervisor general de obras');
  });

  it('[crud-6] PUT /api/contratos/:id/jornadas — reemplaza jornadas completamente', async () => {
    // El contrato recién creado no tiene jornadas — establecemos solo sábado y domingo
    const res = await request(httpServer)
      .put(`/api/contratos/${nuevoContratoId}/jornadas`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        jornadas: [
          { dia_semana: 6, hora_inicio: '07:00', hora_termino: '15:00' },
          { dia_semana: 7, hora_inicio: '07:00', hora_termino: '13:00' },
        ],
      });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(2);
    expect(res.body.map((j: { dia_semana: number }) => j.dia_semana).sort()).toEqual([6, 7]);
  });

  it('[crud-7] GET /api/contratos/:id/jornadas — refleja el reemplazo de crud-6', async () => {
    const res = await request(httpServer)
      .get(`/api/contratos/${nuevoContratoId}/jornadas`)
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
    // No debe haber días de lunes a viernes
    const dias = res.body.map((j: { dia_semana: number }) => j.dia_semana);
    expect(dias).not.toContain(1);
    expect(dias).not.toContain(5);
    expect(dias).toContain(6);
    expect(dias).toContain(7);
  });

  it('[con-10] PUT /api/contratos/:id/jornadas — array vacío limpia las jornadas', async () => {
    const res = await request(httpServer)
      .put(`/api/contratos/${nuevoContratoId}/jornadas`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ jornadas: [] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('[con-11] PUT jornadas — día repetido devuelve 400', async () => {
    const res = await request(httpServer)
      .put(`/api/contratos/${nuevoContratoId}/jornadas`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        jornadas: [
          { dia_semana: 1, hora_inicio: '08:00', hora_termino: '17:00' },
          { dia_semana: 1, hora_inicio: '09:00', hora_termino: '18:00' }, // duplicado
        ],
      });
    expect(res.status).toBe(400);
  });
});
