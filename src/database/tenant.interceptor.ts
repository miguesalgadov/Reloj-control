import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Inject,
  Logger,
} from '@nestjs/common';
import { Observable, from, lastValueFrom } from 'rxjs';
import { Pool } from 'pg';
import { PG_POOL } from './database.module';
import { Request } from 'express';

/**
 * Interceptor que envuelve cada request autenticada en una transaccion
 * Postgres y aplica el contexto de tenant via SET LOCAL.
 *
 * Lifecycle por request autenticada:
 *   1. Toma un client del pool.
 *   2. BEGIN
 *   3. SET LOCAL ROLE app_user  (RLS aplica)
 *   4. SET LOCAL app.tenant_id = <tenant del JWT>
 *   5. Adjunta el client a req.dbClient
 *   6. Ejecuta el handler
 *   7. Si todo OK: COMMIT. Si hubo excepcion: ROLLBACK.
 *   8. Devuelve el client al pool.
 *
 * Para rutas SIN autenticacion (login, health) este interceptor hace
 * passthrough: no inicia transaccion ni setea tenant. Esas rutas deben
 * llamar a funciones SECURITY DEFINER si necesitan tocar la DB.
 *
 * NOTA: en NestJS los interceptors corren DESPUES de los guards. Por eso
 * podemos leer req.user con seguridad cuando aplica.
 */
@Injectable()
export class TenantInterceptor implements NestInterceptor {
  private readonly logger = new Logger(TenantInterceptor.name);

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    return from(this.runInTransaction(req, next));
  }

  private async runInTransaction(req: Request, next: CallHandler): Promise<unknown> {
    const user = req.user;

    // Passthrough para rutas no autenticadas (no hay tenant que setear).
    if (!user || !user.tenantId) {
      return lastValueFrom(next.handle());
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE app_user');
      // set_config acepta parametros (SET LOCAL no lo hace); el tercer arg true = LOCAL.
      // El cast ::uuid dentro del valor valida defensivamente contra basura en el JWT.
      await client.query(
        "SELECT set_config('app.tenant_id', $1::uuid::text, true)",
        [user.tenantId],
      );

      // Inyectamos el client en req para que @DbClient() lo recupere.
      req.dbClient = client;

      const result = await lastValueFrom(next.handle());

      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        this.logger.error('Fallo el ROLLBACK', rollbackErr);
      }
      throw err;
    } finally {
      client.release();
    }
  }
}
