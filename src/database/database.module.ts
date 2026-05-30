import { Global, Module, OnApplicationShutdown, Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';

/**
 * Token de inyeccion para el pool de Postgres. La API se conecta como
 * `app_login` (rol con LOGIN, miembro de `app_user`). El TenantInterceptor
 * hace SET LOCAL ROLE app_user + SET LOCAL app.tenant_id por transaccion.
 */
export const PG_POOL = Symbol('PG_POOL');

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Pool => {
        const pool = new Pool({
          connectionString: config.getOrThrow<string>('DATABASE_URL'),
          max: 20,
          idleTimeoutMillis: 30_000,
          connectionTimeoutMillis: 5_000,
          // statement_timeout defensivo: 30s. Para reportes pesados subir
          // a nivel de query especifica con SET LOCAL.
          statement_timeout: 30_000,
          application_name: 'reloj-control-api',
        });

        pool.on('error', (err) => {
          // Errores asincronos en clients idle del pool. Loguear pero no
          // tirar el proceso; el pool reconecta.
          new Logger('PgPool').error('Error en client idle del pool', err);
        });

        return pool;
      },
    },
  ],
  exports: [PG_POOL],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
