import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request = require('supertest');
import { createTestApp } from './setup/test-app';
import { resetTestDatabase } from './setup/test-database';
import { setPasswordForUsers, PASSWORD_DEMO } from './setup/test-users';

const JUAN_EMAIL    = 'juan.perez@constructoradelsur.cl';
const ADMIN_A_EMAIL = 'admin@constructoradelsur.cl';
const TENANT_A      = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let httpServer: ReturnType<INestApplication['getHttpServer']>;

  beforeAll(async () => {
    await resetTestDatabase();
    await setPasswordForUsers();
    ({ app, httpServer } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it('[auth-1] login con credenciales válidas devuelve 201 + accessToken + usuario', async () => {
    const res = await request(httpServer)
      .post('/api/auth/login')
      .send({ email: JUAN_EMAIL, password: PASSWORD_DEMO });

    expect(res.status).toBe(201);
    expect(typeof res.body.accessToken).toBe('string');
    expect(res.body.accessToken.length).toBeGreaterThan(0);
    expect(res.body.usuario).toMatchObject({
      nombres: 'Juan',
      rol: 'trabajador',
      tenantId: TENANT_A,
    });
  });

  it('[auth-2] login con password incorrecto devuelve 401', async () => {
    const res = await request(httpServer)
      .post('/api/auth/login')
      .send({ email: JUAN_EMAIL, password: 'passwordMalo123' });

    expect(res.status).toBe(401);
  });

  it('[auth-3] login con email inexistente devuelve 401', async () => {
    const res = await request(httpServer)
      .post('/api/auth/login')
      .send({ email: 'noexiste@test.cl', password: PASSWORD_DEMO });

    expect(res.status).toBe(401);
  });

  it('[auth-4] login sin campo email devuelve 400', async () => {
    const res = await request(httpServer)
      .post('/api/auth/login')
      .send({ password: PASSWORD_DEMO });

    expect(res.status).toBe(400);
  });

  it('[auth-5] login sin campo password devuelve 400', async () => {
    const res = await request(httpServer)
      .post('/api/auth/login')
      .send({ email: JUAN_EMAIL });

    expect(res.status).toBe(400);
  });

  it('[auth-6] token de Tenant A contiene tenantId y rol correctos', async () => {
    const res = await request(httpServer)
      .post('/api/auth/login')
      .send({ email: ADMIN_A_EMAIL, password: PASSWORD_DEMO });

    expect(res.status).toBe(201);

    const jwtService = app.get(JwtService);
    const payload = jwtService.decode(res.body.accessToken) as Record<string, unknown>;

    expect(payload.tenantId).toBe(TENANT_A);
    expect(payload.rol).toBe('admin_empresa');
    // admin no tiene trabajadorId
    expect(payload.trabajadorId).toBeNull();
  });
});
