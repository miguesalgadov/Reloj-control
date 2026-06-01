import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { ContratosRepository, ContratoRow, JornadaPactadaRow } from './contratos.repository';
import type { ListarContratosDto } from './dto/listar-contratos.dto';
import type { CrearContratoDto } from './dto/crear-contrato.dto';
import type { ActualizarContratoDto } from './dto/actualizar-contrato.dto';
import type { TerminarContratoDto } from './dto/terminar-contrato.dto';
import type { SetJornadasDto } from './dto/set-jornadas.dto';
import type { JwtPayload } from '../types/express';

@Injectable()
export class ContratosService {
  constructor(private readonly repo: ContratosRepository) {}

  async listar(
    dto: ListarContratosDto,
    db: PoolClient,
  ): Promise<{ data: ContratoRow[]; total: number; limit: number; offset: number }> {
    const limit = dto.limit ?? 50;
    const offset = dto.offset ?? 0;
    const { data, total } = await this.repo.findAll(dto.trabajador_id, dto.estado, limit, offset, db);
    return { data, total, limit, offset };
  }

  async findById(id: string, db: PoolClient) {
    const contrato = await this.repo.findById(id, db);
    if (!contrato) throw new NotFoundException('Contrato no encontrado');
    return contrato;
  }

  async crear(dto: CrearContratoDto, user: JwtPayload, db: PoolClient): Promise<ContratoRow> {
    if (dto.fecha_termino && dto.fecha_termino <= dto.fecha_inicio) {
      throw new BadRequestException('fecha_termino debe ser posterior a fecha_inicio');
    }

    if (['plazo_fijo', 'obra_faena'].includes(dto.tipo_contrato) && !dto.fecha_termino) {
      throw new BadRequestException(`El tipo de contrato '${dto.tipo_contrato}' requiere fecha_termino`);
    }

    const vigentes = await this.repo.countVigentes(dto.trabajador_id, db);
    if (vigentes > 0) {
      throw new ConflictException('El trabajador ya tiene un contrato vigente. Termine el contrato vigente primero.');
    }

    const contrato = await this.repo.create(user.tenantId, dto, db);

    await this.registrarEvento(db, {
      tenantId: user.tenantId,
      categoria: 'gestion_contrato',
      accion: 'crear_contrato',
      actorId: user.sub,
      entidadId: contrato.id,
      payload: { trabajador_id: dto.trabajador_id, tipo_contrato: dto.tipo_contrato },
    });

    return contrato;
  }

  async actualizar(
    id: string,
    dto: ActualizarContratoDto,
    user: JwtPayload,
    db: PoolClient,
  ): Promise<ContratoRow> {
    const contrato = await this.repo.findById(id, db);
    if (!contrato) throw new NotFoundException('Contrato no encontrado');

    if (contrato.estado !== 'vigente') {
      throw new BadRequestException('Solo se pueden modificar contratos vigentes');
    }

    if (dto.fecha_termino) {
      const hoy = new Date().toISOString().slice(0, 10);
      if (dto.fecha_termino < hoy) {
        throw new BadRequestException('No se puede acortar el contrato a una fecha pasada');
      }
    }

    const actualizado = await this.repo.update(id, dto, db);
    if (!actualizado) throw new NotFoundException('Contrato no encontrado');

    await this.registrarEvento(db, {
      tenantId: user.tenantId,
      categoria: 'gestion_contrato',
      accion: 'actualizar_contrato',
      actorId: user.sub,
      entidadId: id,
      payload: dto,
    });

    return actualizado;
  }

  async terminar(
    id: string,
    dto: TerminarContratoDto,
    user: JwtPayload,
    db: PoolClient,
  ): Promise<ContratoRow> {
    const contrato = await this.repo.findById(id, db);
    if (!contrato) throw new NotFoundException('Contrato no encontrado');

    if (contrato.estado !== 'vigente') {
      throw new BadRequestException('El contrato no está vigente');
    }

    const fechaTermino = dto.fecha_termino ?? new Date().toISOString().slice(0, 10);
    const actualizado = await this.repo.terminar(id, fechaTermino, db);
    if (!actualizado) throw new NotFoundException('Contrato no encontrado');

    await this.registrarEvento(db, {
      tenantId: user.tenantId,
      categoria: 'gestion_contrato',
      accion: 'terminar_contrato',
      actorId: user.sub,
      entidadId: id,
      payload: { motivo: dto.motivo, fecha_termino: fechaTermino },
    });

    return actualizado;
  }

  async getJornadas(contratoId: string, db: PoolClient): Promise<JornadaPactadaRow[]> {
    const contrato = await this.repo.findById(contratoId, db);
    if (!contrato) throw new NotFoundException('Contrato no encontrado');
    return this.repo.getJornadas(contratoId, db);
  }

  async setJornadas(
    contratoId: string,
    dto: SetJornadasDto,
    user: JwtPayload,
    db: PoolClient,
  ): Promise<JornadaPactadaRow[]> {
    const contrato = await this.repo.findById(contratoId, db);
    if (!contrato) throw new NotFoundException('Contrato no encontrado');

    const jornadas = await this.repo.setJornadas(contratoId, user.tenantId, dto.jornadas, db);

    await this.registrarEvento(db, {
      tenantId: user.tenantId,
      categoria: 'gestion_jornada',
      accion: 'set_jornadas',
      actorId: user.sub,
      entidadId: contratoId,
      payload: { dias: dto.jornadas.map((j) => j.dia_semana) },
    });

    return jornadas;
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
        'contrato',
        opts.entidadId,
        JSON.stringify(opts.payload),
      ],
    );
  }
}
