import { Client } from 'pg';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const TEST_DB_NAME = 'reloj_control_test';
const ROOT = path.resolve(__dirname, '../..');

function adminUrl(): string {
  const url = process.env.ADMIN_DATABASE_URL;
  if (!url) throw new Error('ADMIN_DATABASE_URL no está definida en .env.test');
  return url;
}

function testDbUrl(): string {
  const url = process.env.TEST_MIGRATION_DATABASE_URL;
  if (!url) throw new Error('TEST_MIGRATION_DATABASE_URL no está definida en .env.test');
  return url;
}

async function dbExists(): Promise<boolean> {
  const client = new Client({ connectionString: adminUrl() });
  await client.connect();
  try {
    const { rows } = await client.query<{ count: string }>(
      "SELECT COUNT(*) AS count FROM pg_database WHERE datname = $1",
      [TEST_DB_NAME],
    );
    return parseInt(rows[0].count, 10) > 0;
  } finally {
    await client.end();
  }
}

export async function dropTestDatabase(): Promise<void> {
  const client = new Client({ connectionString: adminUrl() });
  await client.connect();
  try {
    // Terminar conexiones activas antes de dropear
    await client.query(
      `SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [TEST_DB_NAME],
    );
    await client.query(`DROP DATABASE IF EXISTS ${TEST_DB_NAME}`);
  } finally {
    await client.end();
  }
}

async function runBootstrap(): Promise<void> {
  const bootstrapSql = fs.readFileSync(
    path.join(ROOT, 'db/bootstrap/000_bootstrap.sql'),
    'utf8',
  );
  const client = new Client({ connectionString: testDbUrl() });
  await client.connect();
  try {
    await client.query(bootstrapSql);
  } finally {
    await client.end();
  }
}

async function runMigrations(): Promise<void> {
  execSync(
    'npx node-pg-migrate --migration-file-language sql -m db/migrations --database-url-var TEST_MIGRATION_DATABASE_URL up',
    {
      cwd: ROOT,
      env: { ...process.env },
      stdio: 'pipe',
    },
  );
}

async function runSeed(): Promise<void> {
  const seedSql = fs.readFileSync(
    path.join(ROOT, 'db/seeds/dev_seed.sql'),
    'utf8',
  );
  const client = new Client({ connectionString: testDbUrl() });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE admin_migrate');
    await client.query(seedSql);
    await client.query('COMMIT');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    await client.end();
  }
}

export async function createTestDatabase(): Promise<void> {
  await dropTestDatabase();

  const adminClient = new Client({ connectionString: adminUrl() });
  await adminClient.connect();
  try {
    await adminClient.query(`CREATE DATABASE ${TEST_DB_NAME}`);
  } finally {
    await adminClient.end();
  }

  await runBootstrap();
  await runMigrations();
  await runSeed();
}

// Camino rapido: aplica migraciones pendientes + TRUNCATE + reseed.
// Camino lento (primera ejecucion o DB inexistente): crea desde cero.
export async function resetTestDatabase(): Promise<void> {
  const exists = await dbExists();
  if (!exists) {
    await createTestDatabase();
    return;
  }

  // Aplica migraciones pendientes (no-op si ya están al día).
  await runMigrations();

  const seedSql = fs.readFileSync(
    path.join(ROOT, 'db/seeds/dev_seed.sql'),
    'utf8',
  );
  const client = new Client({ connectionString: testDbUrl() });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE admin_migrate');
    // CASCADE maneja el orden de FK. TRUNCATE no dispara triggers de fila,
    // lo que permite limpiar marcaciones sin chocar con el trigger append-only.
    await client.query(
      'TRUNCATE rc.marcaciones, rc.jornadas_pactadas, rc.contratos, rc.trabajadores, rc.usuarios, rc.centros_trabajo, rc.tenants CASCADE',
    );
    await client.query(seedSql);
    await client.query('COMMIT');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    await client.end();
  }
}
