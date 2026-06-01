import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createTestApp } from './setup/test-app';
import { resetTestDatabase } from './setup/test-database';
import { setPasswordForUsers, PASSWORD_DEMO } from './setup/test-users';

const TENANT_A      = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ADMIN_A_EMAIL = 'admin@constructoradelsur.cl';
const ADMIN_B_EMAIL = 'admin@innovadx.cl';
const JUAN_EMAIL    = 'juan.perez@constructoradelsur.cl';
const JUAN_USER_ID  = 'a3333333-3333-3333-3333-333333333333';

describe('CRUD Usuarios (e2e)', () => {
  let app: INestApplication;
  let httpServer: ReturnType<INestApplication['getHttpServer']>;
  let tokenAdmin: string;
  let tokenJuan: string;
  let createdUserId: string;

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

  it('[usr-1] GET /api/usuarios — admin recibe lista paginada', async () => {
    const res = await request(httpServer)
      .get('/api/usuarios')
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(typeof res.body.total).toBe('number');
    expect(res.body.limit).toBeDefined();
    expect(res.body.offset).toBeDefined();
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data[0]).not.toHaveProperty('password_hash');
  });

  it('[usr-2] GET /api/usuarios — trabajador recibe 403', async () => {
    const res = await request(httpServer)
      .get('/api/usuarios')
      .set('Authorization', `Bearer ${tokenJuan}`);
    expect(res.status).toBe(403);
  });

  it('[usr-3] GET /api/usuarios — sin token recibe 401', async () => {
    const res = await request(httpServer).get('/api/usuarios');
    expect(res.status).toBe(401);
  });

  it('[usr-4] GET /api/usuarios?estado=activo — filtra por estado', async () => {
    const res = await request(httpServer)
      .get('/api/usuarios?estado=activo')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(200);
    res.body.data.forEach((u: { estado: string }) => expect(u.estado).toBe('activo'));
  });

  it('[usr-5] GET /api/usuarios/me — devuelve usuario propio con trabajador_id', async () => {
    const res = await request(httpServer)
      .get('/api/usuarios/me')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(200);
    expect(res.body.email).toBe(ADMIN_A_EMAIL);
    expect(res.body).toHaveProperty('trabajador_id');
  });

  it('[usr-6] GET /api/usuarios/:id — admin puede ver detalle con mfa_enabled', async () => {
    const res = await request(httpServer)
      .get(`/api/usuarios/${JUAN_USER_ID}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(JUAN_USER_ID);
    expect(res.body).toHaveProperty('mfa_enabled');
  });

  it('[usr-7] GET /api/usuarios/:id — 404 para UUID que no existe', async () => {
    const res = await request(httpServer)
      .get('/api/usuarios/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(404);
  });

  it('[crud-1] GET /api/usuarios — admin A solo ve usuarios de tenant A (aislamiento RLS)', async () => {
    const res = await request(httpServer)
      .get('/api/usuarios')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(200);
    // Tenant B tiene admin@innovadx.cl — no debe aparecer
    const emails: string[] = res.body.data.map((u: { email: string }) => u.email);
    expect(emails).not.toContain(ADMIN_B_EMAIL);
  });

  // ─── Mutaciones ───────────────────────────────────────────────────────────

  it('[usr-8] POST /api/usuarios — admin crea usuario nuevo (201)', async () => {
    const res = await request(httpServer)
      .post('/api/usuarios')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        email: 'supervisor.test@constructoradelsur.cl',
        password: 'ClaveSegura2024!',
        nombres: 'Sofia',
        apellidos: 'Ramirez Vega',
        rol: 'supervisor',
      });

    expect(res.status).toBe(201);
    expect(res.body.email).toBe('supervisor.test@constructoradelsur.cl');
    expect(res.body.rol).toBe('supervisor');
    expect(res.body).not.toHaveProperty('password_hash');
    createdUserId = res.body.id;
  });

  it('[usr-9] POST /api/usuarios — email duplicado devuelve 409', async () => {
    const res = await request(httpServer)
      .post('/api/usuarios')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        email: 'supervisor.test@constructoradelsur.cl',
        password: 'ClaveSegura2024!',
        nombres: 'Otro',
        apellidos: 'Nombre',
        rol: 'supervisor',
      });
    expect(res.status).toBe(409);
  });

  it('[usr-10] POST /api/usuarios — DTO inválido (password corta) devuelve 400', async () => {
    const res = await request(httpServer)
      .post('/api/usuarios')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ email: 'x@x.cl', password: 'corta', nombres: 'X', apellidos: 'Y', rol: 'supervisor' });
    expect(res.status).toBe(400);
  });

  it('[usr-11] PATCH /api/usuarios/:id — actualiza apellidos', async () => {
    const res = await request(httpServer)
      .patch(`/api/usuarios/${createdUserId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ apellidos: 'Ramirez Actualizado' });
    expect(res.status).toBe(200);
    expect(res.body.apellidos).toBe('Ramirez Actualizado');
  });

  it('[usr-12] POST /api/usuarios/:id/suspender — suspende usuario', async () => {
    const res = await request(httpServer)
      .post(`/api/usuarios/${createdUserId}/suspender`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ motivo: 'Prueba de suspension automatizada en e2e test' });
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('suspendido');
  });

  it('[usr-13] POST /api/usuarios/:id/reactivar — 400 si ya está activo (no suspendido)', async () => {
    // Juan está activo, no suspendido
    const res = await request(httpServer)
      .post(`/api/usuarios/${JUAN_USER_ID}/reactivar`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ motivo: 'Intento reactivar usuario que no está suspendido' });
    expect(res.status).toBe(400);
  });

  it('[usr-14] POST /api/usuarios/:id/reactivar — reactiva el usuario suspendido en usr-12', async () => {
    const res = await request(httpServer)
      .post(`/api/usuarios/${createdUserId}/reactivar`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ motivo: 'Reactivacion correcta de usuario en prueba e2e' });
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('activo');
  });

  it('[usr-15] POST /api/usuarios/:id/reset-password — admin resetea password de otro usuario', async () => {
    const res = await request(httpServer)
      .post(`/api/usuarios/${createdUserId}/reset-password`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ password_temporal: 'NuevaClave2024!' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('[usr-16] POST /api/usuarios/me/cambiar-password — cambio de propia contraseña', async () => {
    const res = await request(httpServer)
      .post('/api/usuarios/me/cambiar-password')
      .set('Authorization', `Bearer ${tokenJuan}`)
      .send({ password_actual: PASSWORD_DEMO, password_nueva: 'NuevaClave2024Juan!' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('[usr-17] POST /api/usuarios/me/cambiar-password — 401 si password_actual incorrecta', async () => {
    const res = await request(httpServer)
      .post('/api/usuarios/me/cambiar-password')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ password_actual: 'claveEquivocada123!', password_nueva: 'ClaveNueva2024!' });
    expect(res.status).toBe(401);
  });
});
