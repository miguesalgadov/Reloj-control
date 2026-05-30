import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { DatabaseError } from 'pg';

/**
 * Convierte errores de Postgres a respuestas HTTP coherentes.
 *
 * Reglas:
 *   - 23505 (unique_violation)      -> 409 Conflict
 *   - 23503 (foreign_key_violation) -> 400 Bad Request
 *   - 23514 (check_violation)       -> 400 Bad Request (errores de RUT, hash, geocerca, etc.)
 *   - 42501 (insufficient_privilege) -> 403 Forbidden (intentos de UPDATE/DELETE en append-only)
 *   - 23502 (not_null_violation)    -> 400
 *   - Otros                         -> 500
 *
 * Nunca devolvemos el mensaje crudo de Postgres al cliente (puede filtrar
 * estructura interna). Logueamos el detalle y respondemos genericamente.
 */
@Catch(DatabaseError)
export class PostgresExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PostgresExceptionFilter.name);

  catch(exception: DatabaseError, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest();

    const { status, mensaje } = this.mapErrorCode(exception);

    // Log completo del error original (queda en server, no en respuesta)
    this.logger.error(
      `Postgres error ${exception.code} en ${request.method} ${request.url}: ` +
        `${exception.message} | constraint=${exception.constraint} | detail=${exception.detail}`,
    );

    response.status(status).json({
      statusCode: status,
      message: mensaje,
      // El codigo Postgres se incluye para debugging en dev/staging.
      // En prod considerar omitirlo.
      pgCode: exception.code,
    });
  }

  private mapErrorCode(err: DatabaseError): { status: number; mensaje: string } {
    switch (err.code) {
      case '23505':
        return { status: HttpStatus.CONFLICT, mensaje: 'Recurso duplicado' };
      case '23503':
        return {
          status: HttpStatus.BAD_REQUEST,
          mensaje: 'Referencia invalida (foreign key)',
        };
      case '23514':
        return {
          status: HttpStatus.BAD_REQUEST,
          mensaje: `Validacion fallida: ${err.constraint ?? 'check constraint'}`,
        };
      case '23502':
        return { status: HttpStatus.BAD_REQUEST, mensaje: 'Falta campo obligatorio' };
      case '42501':
        return {
          status: HttpStatus.FORBIDDEN,
          mensaje: 'Operacion no permitida sobre este recurso',
        };
      case 'P0001':
        // RAISE EXCEPTION generico desde una funcion plpgsql.
        return { status: HttpStatus.BAD_REQUEST, mensaje: err.message };
      default:
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          mensaje: 'Error interno de base de datos',
        };
    }
  }
}
