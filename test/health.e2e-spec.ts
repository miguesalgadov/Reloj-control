import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createTestApp } from './setup/test-app';
import { resetTestDatabase } from './setup/test-database';
import { setPasswordForUsers } from './setup/test-users';

describe('Health (e2e)', () => {
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

  it('[health-1] GET /api/health devuelve 200 con status ok y db up', async () => {
    const res = await request(httpServer).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.db).toBe('up');
    expect(typeof res.body.uptime).toBe('number');
  });
});
