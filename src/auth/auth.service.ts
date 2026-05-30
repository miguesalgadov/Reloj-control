import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Pool } from 'pg';
import * as argon2 from 'argon2';
import { PG_POOL } from '../database/database.module';
import type { JwtPayload } from '../types/express';

interface UsuarioParaLogin {
  id: string;
  tenant_id: string;
  email: string;
  password_hash: string;
  rol: 'admin_empresa' | 'supervisor' | 'trabajador';
  estado: string;
  nombres: string;
  apellidos: string;
  trabajador_id: string | null;
}

export interface LoginResult {
  accessToken: string;
  usuario: {
    id: string;
    nombres: string;
    apellidos: string;
    rol: string;
    tenantId: string;
  };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly jwt: JwtService,
  ) {}

  /**
   * Login. No pasa por TenantInterceptor (el tenant se descubre aqui).
   * Usa la funcion SECURITY DEFINER rc.buscar_usuario_para_login que
   * bypasea RLS de manera controlada.
   *
   * Audit: registramos login_exitoso o login_fallido en ambos casos para
   * detectar fuerza bruta o credenciales filtradas.
   */
  async login(
    email: string,
    password: string,
    ipOrigen: string | null,
    userAgent: string | null,
  ): Promise<LoginResult> {
    const { rows } = await this.pool.query<UsuarioParaLogin>(
      'SELECT * FROM rc.buscar_usuario_para_login($1)',
      [email],
    );

    if (rows.length === 0) {
      // Hacemos verify dummy igual para evitar timing attack que distinga
      // "usuario no existe" de "password malo".
      await this.verifyDummy(password);
      throw new UnauthorizedException('Credenciales invalidas');
    }

    if (rows.length > 1) {
      // Email duplicado entre tenants (no deberia pasar en MVP).
      this.logger.warn(`Email ${email} encontrado en ${rows.length} tenants`);
      throw new UnauthorizedException(
        'Email ambiguo. Contacte al administrador.',
      );
    }

    const usuario = rows[0];

    const passwordValido = await argon2.verify(usuario.password_hash, password);

    // Registrar evento de login (exitoso o fallido) en audit_log.
    await this.pool.query(
      'SELECT rc.registrar_evento_login($1, $2, $3, $4, $5, $6)',
      [
        usuario.tenant_id,
        email,
        passwordValido,
        usuario.id,
        ipOrigen,
        userAgent,
      ],
    ).catch((err) => {
      // No bloqueamos el login si el audit falla, pero lo logueamos.
      this.logger.error('Fallo audit de login', err);
    });

    if (!passwordValido) {
      throw new UnauthorizedException('Credenciales invalidas');
    }

    const payload: JwtPayload = {
      sub: usuario.id,
      tenantId: usuario.tenant_id,
      rol: usuario.rol,
      trabajadorId: usuario.trabajador_id,
    };

    const accessToken = await this.jwt.signAsync(payload);

    return {
      accessToken,
      usuario: {
        id: usuario.id,
        nombres: usuario.nombres,
        apellidos: usuario.apellidos,
        rol: usuario.rol,
        tenantId: usuario.tenant_id,
      },
    };
  }

  /**
   * Verificacion dummy de password para mantener tiempo constante cuando
   * el usuario no existe. argon2 es deliberadamente lento; sin esto, un
   * atacante podria enumerar emails validos por diferencia de latencia.
   */
  private async verifyDummy(password: string): Promise<void> {
    const DUMMY_HASH =
      '$argon2id$v=19$m=65536,t=3,p=4$ZHVtbXlzYWx0$' +
      'wQqz3jDh3KqEZ2C8gJZ1bX1qLg7VxYhNvKj0gV5tT5Q';
    try {
      await argon2.verify(DUMMY_HASH, password);
    } catch {
      // ignore
    }
  }
}
