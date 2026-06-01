import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { CentrosRepository, CentroRow } from './centros.repository';
import type { CrearCentroDto } from './dto/crear-centro.dto';
import type { ActualizarCentroDto } from './dto/actualizar-centro.dto';
import type { InactivarCentroDto } from './dto/inactivar-centro.dto';
import type { JwtPayload } from '../types/express';

@Injectable()
export class CentrosService {
  constructor(private readonly repo: CentrosRepository) {}

  async listar(
    estado: string | undefined,
    limit: number,
    offset: number,
    db: PoolClient,
  ): Promise<{ data: CentroRow[]; total: number; limit: number; offset: number }> {
    const { data, total } = await this.repo.findAll(estado, limit, offset, db);
    return { data, total, limit, offset };
  }

  async findById(id: string, db: PoolClient): Promise<CentroRow> {
    const centro = await this.repo.findById(id, db);
    if (!centro) throw new NotFoundException('Centro de trabajo no encontrado');
    return centro;
  }

  async crear(dto: CrearCentroDto, user: JwtPayload, db: PoolClient): Promise<CentroRow> {
    const centro = await this.repo.create(user.tenantId, dto, db);

    await this.registrarEvento(db, {
      tenantId: user.tenantId,
      accion: 'crear_centro',
      actorId: user.sub,
      entidadId: centro.id,
      payload: { nombre: centro.nombre },
    });

    return centro;
  }

  async actualizar(
    id: string,
    dto: ActualizarCentroDto,
    user: JwtPayload,
    db: PoolClient,
  ): Promise<CentroRow> {
    const centro = await this.repo.findById(id, db);
    if (!centro) throw new NotFoundException('Centro de trabajo no encontrado');

    const actualizado = await this.repo.update(id, dto, db);
    if (!actualizado) throw new NotFoundException('Centro de trabajo no encontrado');

    await this.registrarEvento(db, {
      tenantId: user.tenantId,
      accion: 'actualizar_centro',
      actorId: user.sub,
      entidadId: id,
      payload: dto,
    });

    return actualizado;
  }

  async inactivar(
    id: string,
    dto: InactivarCentroDto,
    user: JwtPayload,
    db: PoolClient,
  ): Promise<CentroRow> {
    const centro = await this.repo.findById(id, db);
    if (!centro) throw new NotFoundException('Centro de trabajo no encontrado');

    const activos = await this.repo.countTrabajadoresActivos(id, db);
    if (activos > 0) {
      throw new BadRequestException(
        `El centro tiene ${activos} trabajador(es) activo(s) asignado(s). Reasignelos antes de inactivar.`,
      );
    }

    const actualizado = await this.repo.inactivar(id, db);
    if (!actualizado) throw new NotFoundException('Centro de trabajo no encontrado');

    await this.registrarEvento(db, {
      tenantId: user.tenantId,
      accion: 'inactivar_centro',
      actorId: user.sub,
      entidadId: id,
      payload: { motivo: dto.motivo ?? null },
    });

    return actualizado;
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
        'gestion_centro',
        opts.accion,
        'usuario',
        opts.actorId,
        opts.actorId,
        'centro_trabajo',
        opts.entidadId,
        JSON.stringify(opts.payload),
      ],
    );
  }
}
