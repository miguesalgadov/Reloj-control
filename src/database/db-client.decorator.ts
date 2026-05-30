import {
  createParamDecorator,
  ExecutionContext,
  InternalServerErrorException,
} from '@nestjs/common';
import { PoolClient } from 'pg';

/**
 * Param decorator que extrae el PoolClient inyectado por TenantInterceptor.
 *
 * Uso:
 *   @Post()
 *   crear(@Body() dto: Dto, @DbClient() db: PoolClient) { ... }
 *
 * Si la ruta no esta cubierta por TenantInterceptor (porque es publica, o
 * porque el interceptor no se aplico) el decorator falla en runtime con
 * 500. Esto es DELIBERADO: ningun handler de negocio debe acceder a la DB
 * fuera del contexto transaccional con tenant seteado.
 */
export const DbClient = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): PoolClient => {
    const request = ctx.switchToHttp().getRequest();
    if (!request.dbClient) {
      throw new InternalServerErrorException(
        'No hay PoolClient en la request. El TenantInterceptor no se aplico ' +
          'o la ruta es publica (en cuyo caso usa el pool directamente o una ' +
          'funcion SECURITY DEFINER).',
      );
    }
    return request.dbClient;
  },
);
