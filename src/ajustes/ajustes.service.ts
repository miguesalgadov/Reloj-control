import { BadRequestException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { fromZonedTime, formatInTimeZone } from 'date-fns-tz';
import { AjustesRepository } from './ajustes.repository';
import type { CrearAjusteDto } from './dto/crear-ajuste.dto';
import type { ListarAjustesDto } from './dto/listar-ajustes.dto';
import type { JwtPayload } from '../types/express';

const TZ = 'America/Santiago';
const MAX_DIAS_ATRAS = 60;

function parseTimestampLocal(ts: string): Date {
  return fromZonedTime(ts, TZ);
}

function esMesAnteriorEnSantiago(timestampUtc: Date): boolean {
  const ahoraYearMonth = formatInTimeZone(new Date(), TZ, 'yyyy-MM');
  const tsYearMonth = formatInTimeZone(timestampUtc, TZ, 'yyyy-MM');
  return tsYearMonth < ahoraYearMonth;
}

@Injectable()
export class AjustesService {
  constructor(private readonly repo: AjustesRepository) {}

  async crear(dto: CrearAjusteDto, user: JwtPayload, db: PoolClient) {
    // ─── Validar combinación de campos por sub-tipo ────────────────────────
    if (dto.tipo_ajuste === 'creacion' && dto.marcacion_original_id) {
      throw new UnprocessableEntityException('El sub-tipo creacion no admite marcacion_original_id.');
    }
    if (dto.tipo_ajuste !== 'creacion' && !dto.marcacion_original_id) {
      throw new UnprocessableEntityException(`El sub-tipo ${dto.tipo_ajuste} requiere marcacion_original_id.`);
    }

    // ─── Resolver timestamp ────────────────────────────────────────────────
    const tsStr = dto.tipo_ajuste === 'correccion' ? dto.timestamp_local_corregido! : dto.timestamp_local;
    let timestampUtc: Date;

    if (dto.tipo_ajuste === 'anulacion') {
      timestampUtc = new Date();
    } else {
      if (!tsStr) {
        throw new BadRequestException('Se requiere timestamp para este tipo de ajuste.');
      }
      timestampUtc = parseTimestampLocal(tsStr);
    }

    const ahora = new Date();

    // ─── Validar que no sea futuro ─────────────────────────────────────────
    if (dto.tipo_ajuste !== 'anulacion' && timestampUtc > ahora) {
      throw new BadRequestException('El timestamp no puede ser futuro.');
    }

    // ─── Validar plazo máximo ──────────────────────────────────────────────
    if (dto.tipo_ajuste !== 'anulacion') {
      const diffDias = (ahora.getTime() - timestampUtc.getTime()) / (1000 * 60 * 60 * 24);
      if (diffDias > MAX_DIAS_ATRAS) {
        throw new BadRequestException(`No se pueden ajustar marcaciones de más de ${MAX_DIAS_ATRAS} días atrás.`);
      }
    }

    // ─── Validar mes anterior con confirmación ─────────────────────────────
    if (dto.tipo_ajuste !== 'anulacion') {
      if (esMesAnteriorEnSantiago(timestampUtc) && !dto.confirmacion_mes_cerrado) {
        throw new BadRequestException('Marcación del mes anterior. Requiere confirmacion_mes_cerrado: true para proceder.');
      }
    }

    // ─── Validar trabajador ────────────────────────────────────────────────
    const trabExiste = await this.repo.existeTrabajador(dto.trabajador_id, db);
    if (!trabExiste) {
      throw new NotFoundException('Trabajador no encontrado.');
    }

    // ─── Validar marcación original (para correccion / anulacion) ─────────
    let tipoMarcacionRespuesta: string = dto.tipo_marcacion ?? 'ajuste';
    let marcacionOriginalTimestamp: Date | null = null;

    if (dto.marcacion_original_id) {
      const original = await this.repo.findMarcacionOriginal(dto.marcacion_original_id, db);
      if (!original || original.trabajador_id !== dto.trabajador_id) {
        throw new NotFoundException('Marcación original no encontrada o ya fue anulada.');
      }
      if (original.anulada) {
        throw new NotFoundException('Marcación original no encontrada o ya fue anulada.');
      }
      tipoMarcacionRespuesta = original.tipo;
      marcacionOriginalTimestamp = original.timestamp_utc;
    }

    // ─── Para anulaciones, usar el timestamp de la marcación original ──────
    if (dto.tipo_ajuste === 'anulacion' && marcacionOriginalTimestamp) {
      timestampUtc = marcacionOriginalTimestamp;
    }

    // ─── Tipo a almacenar en DB ────────────────────────────────────────────
    // creacion → tipo real (entrada, salida…) sin marcacion_original_id
    // correccion / anulacion → tipo='ajuste' con marcacion_original_id
    const tipoParaDB = dto.tipo_ajuste === 'creacion' ? dto.tipo_marcacion! : 'ajuste';

    // ─── Construir datos_ajuste ────────────────────────────────────────────
    const datosAjuste: Record<string, unknown> = {
      tipo_ajuste: dto.tipo_ajuste,
      motivo: dto.motivo,
      admin_id: user.sub,
    };
    if (dto.tipo_ajuste === 'correccion' && marcacionOriginalTimestamp) {
      datosAjuste['timestamp_original'] = marcacionOriginalTimestamp.toISOString();
      datosAjuste['timestamp_corregido'] = timestampUtc.toISOString();
    }

    // ─── Insertar ajuste ───────────────────────────────────────────────────
    const ajuste = await this.repo.crearAjuste(
      {
        trabajadorId: dto.trabajador_id,
        tipoMarcacion: tipoParaDB,
        timestampUtc,
        latitud: dto.latitud ?? null,
        longitud: dto.longitud ?? null,
        marcacionOriginalId: dto.marcacion_original_id ?? null,
        datosAjuste,
        adminId: user.sub,
      },
      db,
    );

    // ─── Auditoría ─────────────────────────────────────────────────────────
    await this.repo.registrarAuditoria(
      {
        tenantId: user.tenantId,
        adminId: user.sub,
        ajusteId: ajuste.id,
        payload: {
          tipo_ajuste: dto.tipo_ajuste,
          trabajador_id: dto.trabajador_id,
          marcacion_original_id: dto.marcacion_original_id ?? null,
          motivo: dto.motivo,
        },
      },
      db,
    );

    const adminNombre = await this.repo.findAdminNombre(user.sub, db);

    return {
      id: ajuste.id,
      tipo_ajuste: dto.tipo_ajuste,
      trabajador_id: dto.trabajador_id,
      marcacion_original_id: dto.marcacion_original_id ?? null,
      tipo_marcacion: tipoMarcacionRespuesta,
      timestamp_local: dto.tipo_ajuste !== 'anulacion' ? tsStr : null,
      timestamp_utc: timestampUtc.toISOString(),
      creado_por: { id: user.sub, nombre: adminNombre },
      motivo: dto.motivo,
      created_at: ajuste.created_at,
    };
  }

  async listar(dto: ListarAjustesDto, db: PoolClient) {
    const limit = dto.limit ?? 50;
    const offset = dto.offset ?? 0;
    const { data, total } = await this.repo.listar(
      {
        trabajadorId: dto.trabajador_id,
        tipoAjuste: dto.tipo_ajuste,
        desde: dto.desde,
        hasta: dto.hasta,
        creadoPorId: dto.creado_por_id,
        limit,
        offset,
      },
      db,
    );

    return {
      data: data.map(r => this.formatRow(r)),
      total,
      limit,
      offset,
    };
  }

  async detalle(id: string, db: PoolClient) {
    const row = await this.repo.findById(id, db);
    if (!row) throw new NotFoundException('Ajuste no encontrado.');
    return this.formatRow(row);
  }

  private formatRow(r: import('./ajustes.repository').AjusteRow) {
    return {
      id: r.id,
      tipo_ajuste: r.datos_ajuste?.tipo_ajuste,
      trabajador: {
        id: r.trabajador_id,
        rut: r.trabajador_rut,
        nombre_completo: `${r.trabajador_nombres} ${r.trabajador_apellido_paterno}`.trim(),
      },
      tipo_marcacion: r.tipo_marcacion,
      timestamp_utc: r.timestamp_utc,
      marcacion_original_id: r.marcacion_original_id,
      datos_ajuste: r.datos_ajuste,
      motivo: r.datos_ajuste?.motivo,
      creado_por: { id: r.creado_por_id, nombre: r.creado_por_nombre },
      created_at: r.created_at,
    };
  }
}
