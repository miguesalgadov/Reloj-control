import { Client } from 'pg';
import * as argon2 from 'argon2';

export const PASSWORD_DEMO = 'Test1234!';

// IDs fijos del seed (tenant B, trabajadora Andrea Lagos no tiene usuario en el seed)
const ANDREA_USER_ID   = 'b3333333-3333-3333-3333-333333333333';
const ANDREA_TRAB_ID   = 'b4444444-4444-4444-4444-444444444444';
const TENANT_B         = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function testDbUrl(): string {
  const url = process.env.TEST_MIGRATION_DATABASE_URL;
  if (!url) throw new Error('TEST_MIGRATION_DATABASE_URL no está definida en .env.test');
  return url;
}

// - Hashea PASSWORD_DEMO y lo asigna a todos los usuarios del seed.
// - Inserta la cuenta de usuario de Andrea Lagos (Tenant B, trabajadora sin usuario).
// - Vincula el trabajador b4444444 al usuario b3333333.
export async function setPasswordForUsers(): Promise<void> {
  const hash = await argon2.hash(PASSWORD_DEMO);

  const client = new Client({ connectionString: testDbUrl() });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE admin_migrate');

    // Actualiza todos los usuarios (placeholders del seed y cualquier re-ejecucion)
    await client.query('UPDATE rc.usuarios SET password_hash = $1', [hash]);

    // Inserta cuenta de Andrea Lagos si no existe, actualiza hash si ya existe
    await client.query(
      `INSERT INTO rc.usuarios (id, tenant_id, email, password_hash, rol, nombres, apellidos)
       VALUES ($1, $2, $3, $4, 'trabajador', 'Andrea', 'Lagos Pino')
       ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
      [ANDREA_USER_ID, TENANT_B, 'andrea.lagos@innovadx.cl', hash],
    );

    // Vincula el trabajador b4444444 con su cuenta de usuario
    await client.query(
      'UPDATE rc.trabajadores SET usuario_id = $1 WHERE id = $2',
      [ANDREA_USER_ID, ANDREA_TRAB_ID],
    );

    await client.query('COMMIT');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    await client.end();
  }
}
