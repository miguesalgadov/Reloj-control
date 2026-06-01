import { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import request = require('supertest');
import { createTestApp } from './setup/test-app';
import { resetTestDatabase } from './setup/test-database';
import { setPasswordForUsers, PASSWORD_DEMO } from './setup/test-users';

const ADMIN_A_EMAIL = 'admin@constructoradelsur.cl';
const JUAN_EMAIL    = 'juan.perez@constructoradelsur.cl';
const JUAN_TRAB_ID  = 'a4444444-4444-4444-4444-444444444444';
const JUAN_USER_ID  = 'a3333333-3333-3333-3333-333333333333';
const PEDRO_TRAB_ID = 'a5555555-5555-5555-5555-555555555555';
// Tenant B RUT — debería poder crearse en tenant A sin conflicto cross-tenant
const RUT_TENANT_B  = '17345678-6';

function testDbUrl(): string {
  const url = process.env.TEST_MIGRATION_DATABASE_URL;
  if (!url) throw new Error('TEST_MIGRATION_DATABASE_URL no definida');
  return url;
}

describe('CRUD Trabajadores (e2e)', () => {
  let app: INestApplication;
  let httpServer: ReturnType<INestApplication['getHttpServer']>;
  let tokenAdmin: string;
  let tokenJuan: string;
  let nuevoTrabId: string;

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

  it('[trab-1] GET /api/trabajadores — admin recibe lista paginada', async () => {
    const res = await request(httpServer)
      .get('/api/trabajadores')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it('[trab-2] GET /api/trabajadores — trabajador recibe 403', async () => {
    const res = await request(httpServer)
      .get('/api/trabajadores')
      .set('Authorization', `Bearer ${tokenJuan}`);
    expect(res.status).toBe(403);
  });

  it('[trab-3] GET /api/trabajadores/:id — detalle incluye contrato_vigente', async () => {
    const res = await request(httpServer)
      .get(`/api/trabajadores/${JUAN_TRAB_ID}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(JUAN_TRAB_ID);
    expect(res.body).toHaveProperty('contrato_vigente');
    expect(res.body.contrato_vigente).not.toBeNull();
  });

  it('[trab-4] GET /api/trabajadores/:id — 404 para UUID inexistente', async () => {
    const res = await request(httpServer)
      .get('/api/trabajadores/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(404);
  });

  // ─── Mutaciones ───────────────────────────────────────────────────────────

  it('[trab-5] POST /api/trabajadores — crea trabajador sin cuenta (201)', async () => {
    const res = await request(httpServer)
      .post('/api/trabajadores')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        rut: '18111222-0',
        nombres: 'Luis',
        apellido_paterno: 'Torres',
        fecha_ingreso: '2026-01-15',
      });

    expect(res.status).toBe(201);
    expect(res.body.rut).toBe('18111222-0');
    expect(res.body.usuario_id).toBeNull();
    nuevoTrabId = res.body.id;
  });

  it('[crud-2] POST /api/trabajadores — RUT existente en tenant B → 201 en tenant A', async () => {
    const res = await request(httpServer)
      .post('/api/trabajadores')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        rut: RUT_TENANT_B,
        nombres: 'Ana',
        apellido_paterno: 'Lagos',
        fecha_ingreso: '2026-02-01',
      });
    // RUT no es único cross-tenant, debe crearse OK
    expect(res.status).toBe(201);
  });

  it('[trab-6] POST /api/trabajadores — RUT duplicado en mismo tenant → 409', async () => {
    const res = await request(httpServer)
      .post('/api/trabajadores')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        rut: '18111222-0',
        nombres: 'Luis Copia',
        apellido_paterno: 'Torres',
        fecha_ingreso: '2026-01-15',
      });
    expect(res.status).toBe(409);
  });

  it('[crud-3] POST /api/trabajadores con crear_cuenta + email duplicado → 409 y trabajador NO creado', async () => {
    const countBefore = await request(httpServer)
      .get('/api/trabajadores')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .query({ limit: 200 });
    const totalBefore = countBefore.body.total as number;

    const res = await request(httpServer)
      .post('/api/trabajadores')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        rut: '19000000-1',
        nombres: 'Conflicto',
        apellido_paterno: 'Cuenta',
        fecha_ingreso: '2026-01-01',
        crear_cuenta: true,
        cuenta: {
          email: 'juan.perez@constructoradelsur.cl', // ya existe en tenant A
          password_temporal: 'ClaveConflicto2024!',
        },
      });

    expect(res.status).toBe(409);

    const countAfter = await request(httpServer)
      .get('/api/trabajadores')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .query({ limit: 200 });
    expect(countAfter.body.total).toBe(totalBefore); // no se creó el trabajador
  });

  it('[trab-7] POST /api/trabajadores con crear_cuenta → crea usuario vinculado', async () => {
    const res = await request(httpServer)
      .post('/api/trabajadores')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        rut: '20000001-3',
        nombres: 'Carmen',
        apellido_paterno: 'Fuentes',
        fecha_ingreso: '2026-03-01',
        crear_cuenta: true,
        cuenta: {
          email: 'carmen.fuentes@constructoradelsur.cl',
          password_temporal: 'ClaveCarmen2024!',
        },
      });

    expect(res.status).toBe(201);
    expect(res.body.usuario_id).toBeTruthy();
  });

  it('[trab-8] PATCH /api/trabajadores/:id — actualiza telefono', async () => {
    const res = await request(httpServer)
      .patch(`/api/trabajadores/${nuevoTrabId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ telefono: '+56912345678' });
    expect(res.status).toBe(200);
    expect(res.body.telefono).toBe('+56912345678');
  });

  it('[trab-9] POST /api/trabajadores/:id/crear-cuenta — crea cuenta para Pedro (sin usuario)', async () => {
    const res = await request(httpServer)
      .post(`/api/trabajadores/${PEDRO_TRAB_ID}/crear-cuenta`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        email: 'pedro.soto@constructoradelsur.cl',
        password_temporal: 'PedroClave2024!',
      });
    expect(res.status).toBe(201);
    expect(res.body.usuario_id).toBeTruthy();
  });

  it('[crud-4] POST /api/trabajadores/:id/desvincular — cascada a contrato y usuario', async () => {
    const res = await request(httpServer)
      .post(`/api/trabajadores/${JUAN_TRAB_ID}/desvincular`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ motivo: 'Desvinculacion por fin de proyecto constructora sur' });

    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('desvinculado');
    expect(res.body.fecha_termino).toBeTruthy();

    // Verificar que el usuario de Juan quedó suspendido
    const usuarioRes = await request(httpServer)
      .get(`/api/usuarios/${JUAN_USER_ID}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(usuarioRes.status).toBe(200);
    expect(usuarioRes.body.estado).toBe('suspendido');
  });
});
