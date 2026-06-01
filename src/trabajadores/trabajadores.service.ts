import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import * as argon2 from 'argon2';
import { TrabajadoresRepository, TrabajadorRow, TrabajadorDetalleRow } from './trabajadores.repository';
import type { ListarTrabajadoresDto } from './dto/listar-trabajadores.dto';
import type { CrearTrabajadorDto } from './dto/crear-trabajador.dto';
import type { ActualizarTrabajadorDto } from './dto/actualizar-trabajador.dto';
import type { DesvincularTrabajadorDto } from './dto/desvincular-trabajador.dto';
import type { CrearCuentaTrabajadorDto } from './dto/crear-cuenta-trabajador.dto';
import type { JwtPayload } from '../types/express';

@Injectable()
export class TrabajadoresService {
  constructor(private readonly repo: TrabajadoresRepository) {}

  async listar(
    dto: ListarTrabajadoresDto,
    db: PoolClient,
  ): Promise<{ data: TrabajadorRow[]; total: number; limit: number; offset: number }> {
    const limit = dto.limit ?? 50;
    const offset = dto.offset ?? 0;
    const { data, total } = await this.repo.findAll(dto.estado, dto.centro_trabajo_id, limit, offset, db);
    return { data, total, limit, offset };
  }

  async findById(id: string, db: PoolClient): Promise<TrabajadorDetalleRow> {
    const t = await this.repo.findById(id, db);
    if (!t) throw new NotFoundException('Trabajador no encontrado');
    return t;
  }

  async crear(
    dto: CrearTrabajadorDto,
    user: JwtPayload,
    db: PoolClient,
  ): Promise<TrabajadorRow> {
    let usuarioId: string | undefined;

    if (dto.crear_cuenta) {
      if (!dto.cuenta) {
        throw new BadRequestException('Se requieren datos de cuenta (email, password_temporal) cuando crear_cuenta=true');
      }
      const hash = await argon2.hash(dto.cuenta.password_temporal);
      const usuario = await this.repo.createUsuario(
        user.tenantId,
        dto.cuenta.email,
        hash,
        dto.nombres,
        dto.apellido_paterno,
        db,
      );
      usuarioId = usuario.id;
    }

    const trabajador = await this.repo.create(
      user.tenantId,
      {
        rut: dto.rut,
        nombres: dto.nombres,
        apellido_paterno: dto.apellido_paterno,
        apellido_materno: dto.apellido_materno,
        fecha_nacimiento: dto.fecha_nacimiento,
        nacionalidad: dto.nacionalidad,
        email: dto.email,
        telefono: dto.telefono,
        centro_trabajo_id: dto.centro_trabajo_id,
        fecha_ingreso: dto.fecha_ingreso,
        usuario_id: usuarioId,
      },
      db,
    );

    await this.registrarEvento(db, {
      tenantId: user.tenantId,
      accion: 'crear_trabajador',
      actorId: user.sub,
      entidadId: trabajador.id,
      payload: { rut: trabajador.rut, nombres: trabajador.nombres, con_cuenta: !!dto.crear_cuenta },
    });

    return trabajador;
  }

  async actualizar(
    id: string,
    dto: ActualizarTrabajadorDto,
    user: JwtPayload,
    db: PoolClient,
  ): Promise<TrabajadorRow> {
    const t = await this.repo.findById(id, db);
    if (!t) throw new NotFoundException('Trabajador no encontrado');

    const actualizado = await this.repo.update(id, dto, db);
    if (!actualizado) throw new NotFoundException('Trabajador no encontrado');

    await this.registrarEvento(db, {
      tenantId: user.tenantId,
      accion: 'actualizar_trabajador',
      actorId: user.sub,
      entidadId: id,
      payload: dto,
    });

    return actualizado;
  }

  async desvincular(
    id: string,
    dto: DesvincularTrabajadorDto,
    user: JwtPayload,
    db: PoolClient,
  ): Promise<TrabajadorRow> {
    const t = await this.repo.findById(id, db);
    if (!t) throw new NotFoundException('Trabajador no encontrado');

    if (t.estado === 'desvinculado') {
      throw new BadRequestException('El trabajador ya está desvinculado');
    }

    const fechaTermino = dto.fecha_termino ?? new Date().toISOString().slice(0, 10);

    await this.repo.terminarContratoVigente(id, fechaTermino, db);

    if (t.usuario_id) {
      await this.repo.suspenderUsuario(t.usuario_id, db);
    }

    const actualizado = await this.repo.desvincular(id, fechaTermino, db);
    if (!actualizado) throw new NotFoundException('Trabajador no encontrado');

    await this.registrarEvento(db, {
      tenantId: user.tenantId,
      accion: 'desvincular_trabajador',
      actorId: user.sub,
      entidadId: id,
      payload: { motivo: dto.motivo, fecha_termino: fechaTermino },
    });

    return actualizado;
  }

  async crearCuenta(
    id: string,
    dto: CrearCuentaTrabajadorDto,
    user: JwtPayload,
    db: PoolClient,
  ): Promise<TrabajadorRow> {
    const t = await this.repo.findById(id, db);
    if (!t) throw new NotFoundException('Trabajador no encontrado');

    if (t.usuario_id) {
      throw new BadRequestException('El trabajador ya tiene una cuenta de usuario asociada');
    }

    const hash = await argon2.hash(dto.password_temporal);
    const usuario = await this.repo.createUsuario(
      user.tenantId,
      dto.email,
      hash,
      t.nombres,
      t.apellido_paterno,
      db,
    );

    await this.repo.linkUsuario(id, usuario.id, db);

    await this.registrarEvento(db, {
      tenantId: user.tenantId,
      accion: 'crear_cuenta_trabajador',
      actorId: user.sub,
      entidadId: id,
      payload: { email: dto.email, usuario_id: usuario.id },
    });

    const actualizado = await this.repo.findById(id, db);
    return actualizado!;
  }

  private async registrarEvento(
    db: PoolClient,
    opts: {
      tenantId: string;
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
        'gestion_trabajador',
        opts.accion,
        'usuario',
        opts.actorId,
        opts.actorId,
        'trabajador',
        opts.entidadId,
        JSON.stringify(opts.payload),
      ],
    );
  }
}
