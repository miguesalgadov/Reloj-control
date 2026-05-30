import { PoolClient } from 'pg';

/**
 * Payload que el JwtStrategy adjunta a la request despues de validar el token.
 * Coincide con lo que firma AuthService al hacer login.
 */
export interface JwtPayload {
  sub: string;             // usuario.id
  tenantId: string;        // usuario.tenant_id
  rol: 'admin_empresa' | 'supervisor' | 'trabajador';
  trabajadorId: string | null;
}

declare global {
  namespace Express {
    // Passport adjunta el resultado de validate() en req.user.
    interface User extends JwtPayload {}

    interface Request {
      /** Inyectado por TenantInterceptor en rutas autenticadas. */
      dbClient?: PoolClient;
    }
  }
}

export {};
