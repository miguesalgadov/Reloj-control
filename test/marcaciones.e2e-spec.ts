import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request = require('supertest');
import { createTestApp } from './setup/test-app';
import { resetTestDatabase } from './setup/test-database';
import { setPasswordForUsers, PASSWORD_DEMO } from './setup/test-users';

const JUAN_EMAIL    = 'juan.perez@constructoradelsur.cl';
const ADMIN_A_EMAIL = 'admin@constructoradelsur.cl';
const TENANT_A      = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CENTRO_A      = 'a1111111-1111-1111-1111-111111111111'; // Tenant A
const CENTRO_B      = 'b1111111-1111-1111-1111-111111111111'; // Tenant B
const JUAN_TRAB_ID  = 'a4444444-4444-4444-4444-444444444444';

// Coordenadas dentro de la geocerca de Obra Plaza Independencia, Concepcion
const GEO_CENTRO_A = { latitud: -36.827, longitud: -73.0498, precisionMetros: 5 };

describe('Marcaciones — creación (e2e)', () => {
  let app: INestApplication;
  let httpServer: ReturnType<INestApplication['getHttpServer']>;
  let tokenJuan: string;
  let tokenAdmin: string;

  beforeAll(async () => {
    await resetTestDatabase();
    await setPasswordForUsers();
    ({ app, httpServer } = await createTestApp());

    const resJuan = await request(httpServer)
      .post('/api/auth/login')
      .send({ email: JUAN_EMAIL, password: PASSWORD_DEMO });
    tokenJuan = resJuan.body.accessToken;

    const resAdmin = await request(httpServer)
      .post('/api/auth/login')
      .send({ email: ADMIN_A_EMAIL, password: PASSWORD_DEMO });
    tokenAdmin = resAdmin.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('[marc-1] POST /api/marcaciones con token válido crea la marcación y devuelve 201', async () => {
    const res = await request(httpServer)
      .post('/api/marcaciones')
      .set('Authorization', `Bearer ${tokenJuan}`)
      .send({ tipo: 'entrada', fuente: 'web', centroTrabajoId: CENTRO_A, ...GEO_CENTRO_A });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.tipo).toBe('entrada');
    expect(res.body.trabajador_id).toBe(JUAN_TRAB_ID);
    expect(res.body.tenant_id).toBe(TENANT_A);
    expect(res.body.hash_actual).toMatch(/^[a-f0-9]{64}$/);
    expect(res.body.hash_anterior).toMatch(/^[a-f0-9]{64}$/);
  });

  it('[marc-2] POST /api/marcaciones sin token devuelve 401', async () => {
    const res = await request(httpServer)
      .post('/api/marcaciones')
      .send({ tipo: 'entrada', fuente: 'web', centroTrabajoId: CENTRO_A, ...GEO_CENTRO_A });

    expect(res.status).toBe(401);
  });

  it('[marc-3] POST /api/marcaciones con token expirado devuelve 401', async () => {
    const jwtService = app.get(JwtService);
    // Firma con expiración de 1 segundo y espera que expire
    const shortToken = await jwtService.signAsync(
      { sub: JUAN_TRAB_ID, tenantId: TENANT_A, rol: 'trabajador', trabajadorId: JUAN_TRAB_ID },
      { expiresIn: 1 },
    );
    await new Promise(r => setTimeout(r, 1100));

    const res = await request(httpServer)
      .post('/api/marcaciones')
      .set('Authorization', `Bearer ${shortToken}`)
      .send({ tipo: 'entrada', fuente: 'web', centroTrabajoId: CENTRO_A, ...GEO_CENTRO_A });

    expect(res.status).toBe(401);
  });

  it('[marc-4] POST /api/marcaciones con latitud fuera de rango devuelve 400', async () => {
    const res = await request(httpServer)
      .post('/api/marcaciones')
      .set('Authorization', `Bearer ${tokenJuan}`)
      .send({ tipo: 'entrada', fuente: 'web', centroTrabajoId: CENTRO_A, latitud: 999, longitud: -73.0498 });

    expect(res.status).toBe(400);
  });

  it('[marc-5] POST /api/marcaciones con centroTrabajoId de otro tenant devuelve 400', async () => {
    // Juan (Tenant A) usa CENTRO_B (Tenant B): registrar_marcacion no lo encuentra → P0001 → 400
    const res = await request(httpServer)
      .post('/api/marcaciones')
      .set('Authorization', `Bearer ${tokenJuan}`)
      .send({ tipo: 'entrada', fuente: 'web', centroTrabajoId: CENTRO_B, ...GEO_CENTRO_A });

    expect(res.status).toBe(400);
  });

  it('[marc-6] POST /api/marcaciones con admin (sin trabajadorId) devuelve 403', async () => {
    const res = await request(httpServer)
      .post('/api/marcaciones')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ tipo: 'entrada', fuente: 'web', centroTrabajoId: CENTRO_A, ...GEO_CENTRO_A });

    expect(res.status).toBe(403);
  });

  it('[marc-7] marcación creada pertenece al tenant del JWT (RLS activo)', async () => {
    // Si TenantInterceptor no setea app.tenant_id, el INSERT falla por RLS.
    // Si este test pasa, confirma que el tenant context está correctamente establecido.
    const res = await request(httpServer)
      .post('/api/marcaciones')
      .set('Authorization', `Bearer ${tokenJuan}`)
      .send({ tipo: 'inicio_colacion', fuente: 'web', centroTrabajoId: CENTRO_A, ...GEO_CENTRO_A });

    expect(res.status).toBe(201);
    expect(res.body.tenant_id).toBe(TENANT_A);
  });

  it('[marc-8] primera marcación del tenant tiene hash_anterior = 64 ceros', async () => {
    // [marc-1] y [marc-7] crearon marcaciones; esta consulta las lista ordenadas por secuencia
    const res = await request(httpServer)
      .get('/api/marcaciones/mias')
      .set('Authorization', `Bearer ${tokenJuan}`);

    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);

    const sorted = [...res.body].sort(
      (a: { secuencia: string }, b: { secuencia: string }) =>
        Number(a.secuencia) - Number(b.secuencia),
    );

    expect(sorted[0].hash_anterior).toBe('0'.repeat(64));
  });

  it('[marc-9] segunda marcación tiene hash_anterior = hash_actual de la primera', async () => {
    const res = await request(httpServer)
      .get('/api/marcaciones/mias')
      .set('Authorization', `Bearer ${tokenJuan}`);

    expect(res.status).toBe(200);

    const sorted = [...res.body].sort(
      (a: { secuencia: string }, b: { secuencia: string }) =>
        Number(a.secuencia) - Number(b.secuencia),
    );

    expect(sorted.length).toBeGreaterThanOrEqual(2);
    expect(sorted[1].hash_anterior).toBe(sorted[0].hash_actual);
  });
});
