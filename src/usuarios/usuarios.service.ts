import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PoolClient } from 'pg';
import * as argon2 from 'argon2';
import { UsuariosRepository, UsuarioMeRow, UsuarioRow } from './usuarios.repository';
import type { ListarUsuariosDto } from './dto/listar-usuarios.dto';
import type { CrearUsuarioDto } from './dto/crear-usuario.dto';
import type { ActualizarUsuarioDto } from './dto/actualizar-usuario.dto';
import type { SuspenderUsuarioDto } from './dto/suspender-usuario.dto';
import type { ResetPasswordDto } from './dto/reset-password.dto';
import type { CambiarPasswordDto } from './dto/cambiar-password.dto';
import type { JwtPayload } from '../types/express';

@Injectable()
export class UsuariosService {
  constructor(private readonly repo: UsuariosRepository) {}

  async listar(
    dto: ListarUsuariosDto,
    db: PoolClient,
  ): Promise<{ data: UsuarioRow[]; total: number; limit: number; offset: number }> {
    const limit = dto.limit ?? 50;
    const offset = dto.offset ?? 0;
    const { data, total } = await this.repo.findAll(dto, db);
    return { data, total, limit, offset };
  }

  async findById(id: string, db: PoolClient): Promise<UsuarioRow> {
    const usuario = await this.repo.findById(id, db);
    if (!usuario) throw new NotFoundException('Usuario no encontrado');
    return usuario;
  }

  async findMe(user: JwtPayload, db: PoolClient): Promise<UsuarioMeRow> {
    const usuario = await this.repo.findMe(user.sub, db);
    if (!usuario) throw new NotFoundException('Usuario no encontrado');
    return usuario;
  }

  async crear(
    dto: CrearUsuarioDto,
    user: JwtPayload,
    db: PoolClient,
  ): Promise<UsuarioRow> {
    const passwordHash = await argon2.hash(dto.password);
    const nuevo = await this.repo.create(
      user.tenantId,
      dto.email,
      passwordHash,
      dto.nombres,
      dto.apellidos,
      dto.rol,
      db,
    );

    await this.registrarEvento(db, {
      tenantId: user.tenantId,
      categoria: 'gestion_usuario',
      accion: 'crear_usuario',
      actorId: user.sub,
      entidadId: nuevo.id,
      payload: { email: nuevo.email, rol: nuevo.rol },
    });

    return nuevo;
  }

  async actualizar(
    id: string,
    dto: ActualizarUsuarioDto,
    user: JwtPayload,
    db: PoolClient,
  ): Promise<UsuarioRow> {
    const usuario = await this.repo.findById(id, db);
    if (!usuario) throw new NotFoundException('Usuario no encontrado');

    const actualizado = await this.repo.update(id, dto, db);
    if (!actualizado) throw new NotFoundException('Usuario no encontrado');

    await this.registrarEvento(db, {
      tenantId: user.tenantId,
      categoria: 'gestion_usuario',
      accion: 'actualizar_usuario',
      actorId: user.sub,
      entidadId: id,
      payload: dto,
    });

    return actualizado;
  }

  async suspender(
    id: string,
    dto: SuspenderUsuarioDto,
    user: JwtPayload,
    db: PoolClient,
  ): Promise<UsuarioRow> {
    const usuario = await this.repo.findById(id, db);
    if (!usuario) throw new NotFoundException('Usuario no encontrado');

    const actualizado = await this.repo.changeEstado(id, 'suspendido', db);
    if (!actualizado) throw new NotFoundException('Usuario no encontrado');

    await this.registrarEvento(db, {
      tenantId: user.tenantId,
      categoria: 'gestion_usuario',
      accion: 'suspender_usuario',
      actorId: user.sub,
      entidadId: id,
      payload: { motivo: dto.motivo },
    });

    return actualizado;
  }

  async reactivar(
    id: string,
    dto: SuspenderUsuarioDto,
    user: JwtPayload,
    db: PoolClient,
  ): Promise<UsuarioRow> {
    const usuario = await this.repo.findById(id, db);
    if (!usuario) throw new NotFoundException('Usuario no encontrado');

    if (usuario.estado !== 'suspendido') {
      throw new BadRequestException(
        `No se puede reactivar un usuario en estado '${usuario.estado}'. Solo se puede reactivar usuarios suspendidos.`,
      );
    }

    const actualizado = await this.repo.changeEstado(id, 'activo', db);
    if (!actualizado) throw new NotFoundException('Usuario no encontrado');

    await this.registrarEvento(db, {
      tenantId: user.tenantId,
      categoria: 'gestion_usuario',
      accion: 'reactivar_usuario',
      actorId: user.sub,
      entidadId: id,
      payload: { motivo: dto.motivo },
    });

    return actualizado;
  }

  async resetPassword(
    id: string,
    dto: ResetPasswordDto,
    user: JwtPayload,
    db: PoolClient,
  ): Promise<{ ok: boolean }> {
    const usuario = await this.repo.findById(id, db);
    if (!usuario) throw new NotFoundException('Usuario no encontrado');

    const hash = await argon2.hash(dto.password_temporal);
    await this.repo.updatePasswordHash(id, hash, db);

    await this.registrarEvento(db, {
      tenantId: user.tenantId,
      categoria: 'gestion_usuario',
      accion: 'reset_password',
      actorId: user.sub,
      entidadId: id,
      payload: {},
    });

    return { ok: true };
  }

  async cambiarPassword(
    dto: CambiarPasswordDto,
    user: JwtPayload,
    db: PoolClient,
  ): Promise<{ ok: boolean }> {
    const usuario = await this.repo.findByIdWithHash(user.sub, db);
    if (!usuario) throw new NotFoundException('Usuario no encontrado');

    const valido = await argon2.verify(usuario.password_hash, dto.password_actual);
    if (!valido) {
      throw new UnauthorizedException('La contraseña actual es incorrecta');
    }

    const hash = await argon2.hash(dto.password_nueva);
    await this.repo.updatePasswordHash(user.sub, hash, db);

    await this.registrarEvento(db, {
      tenantId: user.tenantId,
      categoria: 'gestion_usuario',
      accion: 'cambiar_password',
      actorId: user.sub,
      entidadId: user.sub,
      payload: {},
    });

    return { ok: true };
  }

  private async registrarEvento(
    db: PoolClient,
    opts: {
      tenantId: string;
      categoria: string;
      accion: string;
      actorId: string;
      entidadId: string;
      payload: object;
    },
  ): Promise<void> {
    await db.query(
      `SELECT rc.registrar_evento(
         $1::uuid, $2::rc.audit_categoria, $3, $4::rc.audit_actor_tipo,
         $5, $6, $7, $8::uuid, $9::jsonb
       )`,
      [
        opts.tenantId,
        opts.categoria,
        opts.accion,
        'usuario',
        opts.actorId,
        opts.actorId,
        'usuario',
        opts.entidadId,
        JSON.stringify(opts.payload),
      ],
    );
  }
}
