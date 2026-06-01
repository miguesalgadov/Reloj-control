import { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import request = require('supertest');
import { createTestApp } from './setup/test-app';
import { resetTestDatabase } from './setup/test-database';
import { setPasswordForUsers, PASSWORD_DEMO } from './setup/test-users';

const ADMIN_A_EMAIL = 'admin@constructoradelsur.cl';
const CENTRO_A      = 'a1111111-1111-1111-1111-111111111111';
const GEO_A         = { latitud: -36.827, longitud: -73.0498, precisionMetros: 5 };

function testDbUrl(): string {
  const url = process.env.TEST_MIGRATION_DATABASE_URL;
  if (!url) throw new Error('TEST_MIGRATION_DATABASE_URL no definida');
  return url;
}

describe('Integración CRUD ↔ Motor de Jornada (e2e)', () => {
  let app: INestApplication;
  let httpServer: ReturnType<INestApplication['getHttpServer']>;
  let tokenAdmin: string;
  let tokenNuevo: string;
  let trabajadorId: string;
  let contratoId: string;

  beforeAll(async () => {
    await resetTestDatabase();
    await setPasswordForUsers();
    ({ app, httpServer } = await createTestApp());

    // Configurar jornada para tenant A (necesaria para Motor de Jornada)
    const client = new Client({ connectionString: testDbUrl() });
    await client.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE admin_migrate');
      await client.query(
        `INSERT INTO rc.configuracion_jornada (tenant_id)
         SELECT id FROM rc.tenants WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
         ON CONFLICT (tenant_id) DO NOTHING`,
      );
      await client.query('COMMIT');
    } finally {
      await client.end();
    }

    const r1 = await request(httpServer).post('/api/auth/login').send({ email: ADMIN_A_EMAIL, password: PASSWORD_DEMO });
    tokenAdmin = r1.body.accessToken;
  });

  afterAll(async () => { await app.close(); });

  it('[crud-int-1a] Admin crea trabajador con cuenta de usuario', async () => {
    const res = await request(httpServer)
      .post('/api/trabajadores')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        rut: '21000001-1',
        nombres: 'Roberto',
        apellido_paterno: 'Integral',
        fecha_ingreso: '2026-01-01',
        centro_trabajo_id: CENTRO_A,
        crear_cuenta: true,
        cuenta: {
          email: 'roberto.integral@constructoradelsur.cl',
          password_temporal: 'ClaveRoberto2024!',
        },
      });

    expect(res.status).toBe(201);
    trabajadorId = res.body.id;
    expect(res.body.usuario_id).toBeTruthy();
  });

  it('[crud-int-1b] Admin crea contrato vigente para Roberto', async () => {
    const res = await request(httpServer)
      .post('/api/contratos')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        trabajador_id: trabajadorId,
        tipo_contrato: 'indefinido',
        cargo: 'Operario integral',
        fecha_inicio: '2026-01-01',
        horas_semanales: 44,
      });

    expect(res.status).toBe(201);
    contratoId = res.body.id;
    expect(res.body.estado).toBe('vigente');
  });

  it('[crud-int-1c] Admin setea jornada L-V para Roberto', async () => {
    const res = await request(httpServer)
      .put(`/api/contratos/${contratoId}/jornadas`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        jornadas: [1, 2, 3, 4, 5].map((dia) => ({
          dia_semana: dia,
          hora_inicio: '08:00',
          hora_termino: '18:00',
          colacion_inicio: '13:00',
          colacion_termino: '14:00',
          tolerancia_minutos: 10,
        })),
      });

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(5);
  });

  it('[crud-int-1d] Roberto puede hacer login con la cuenta creada', async () => {
    const res = await request(httpServer)
      .post('/api/auth/login')
      .send({ email: 'roberto.integral@constructoradelsur.cl', password: 'ClaveRoberto2024!' });

    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeTruthy();
    tokenNuevo = res.body.accessToken;
  });

  it('[crud-int-1e] Roberto puede marcar entrada', async () => {
    const res = await request(httpServer)
      .post('/api/marcaciones')
      .set('Authorization', `Bearer ${tokenNuevo}`)
      .send({ tipo: 'entrada', fuente: 'web', centroTrabajoId: CENTRO_A, ...GEO_A });

    expect(res.status).toBe(201);
    expect(res.body.tipo).toBe('entrada');
    expect(res.body.trabajador_id).toBe(trabajadorId);
  });

  it('[crud-8] audit_log registra las operaciones del flujo completo', async () => {
    // Verificar directamente en la DB que se registraron eventos de gestion_trabajador y gestion_contrato
    const client = new Client({ connectionString: testDbUrl() });
    await client.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE admin_migrate');

      const { rows } = await client.query<{ categoria: string; accion: string }>(
        `SELECT categoria::text, accion FROM rc.audit_log
         WHERE tenant_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
           AND categoria IN ('gestion_trabajador', 'gestion_contrato', 'gestion_jornada')
         ORDER BY created_at ASC`,
      );

      await client.query('ROLLBACK');

      const categorias = rows.map((r) => r.categoria);
      expect(categorias).toContain('gestion_trabajador');
      expect(categorias).toContain('gestion_contrato');
      expect(categorias).toContain('gestion_jornada');
    } finally {
      await client.end();
    }
  });
});
