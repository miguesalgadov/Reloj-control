import { ForbiddenException, Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { CrearMarcacionDto } from './dto/crear-marcacion.dto';
import type { JwtPayload } from '../types/express';

export interface MarcacionRow {
  id: string;
  tenant_id: string;
  secuencia: string; // bigint → string en pg
  trabajador_id: string;
  tipo: string;
  fuente: string;
  timestamp_utc: Date;
  centro_trabajo_id: string | null;
  latitud: string | null;
  longitud: string | null;
  precision_metros: string | null;
  dentro_geocerca: boolean | null;
  hash_anterior: string;
  hash_actual: string;
}

@Injectable()
export class MarcacionesService {
  /**
   * Crea una marcacion para el trabajador autenticado.
   *
   * Notas de seguridad:
   *   - El tenant viene del JWT, no del body. Imposible que un usuario
   *     marque para otro tenant.
   *   - El trabajador es el del JWT. Un trabajador solo puede marcarse a
   *     si mismo. (Para admin/supervisor marcando ajustes, sera un endpoint
   *     distinto con permisos explicitos.)
   *   - RLS aplica via SET LOCAL del TenantInterceptor: incluso si por bug
   *     pasaramos un trabajador_id de otro tenant, registrar_marcacion lo
   *     rechaza por su CHECK interno.
   */
  async crear(
    dto: CrearMarcacionDto,
    user: JwtPayload,
    ipOrigen: string | null,
    userAgent: string | null,
    db: PoolClient,
  ): Promise<MarcacionRow> {
    if (!user.trabajadorId) {
      throw new ForbiddenException(
        'El usuario autenticado no esta vinculado a un trabajador. ' +
          'Solo trabajadores con ficha activa pueden registrar marcaciones.',
      );
    }

    const { rows } = await db.query<MarcacionRow>(
      `SELECT * FROM rc.registrar_marcacion(
         p_tenant_id              => $1::uuid,
         p_trabajador_id          => $2::uuid,
         p_tipo                   => $3::rc.tipo_marcacion,
         p_fuente                 => $4::rc.fuente_marcacion,
         p_centro_trabajo_id      => $5::uuid,
         p_latitud                => $6::numeric,
         p_longitud               => $7::numeric,
         p_precision_metros       => $8::numeric,
         p_ip_origen              => $9::inet,
         p_user_agent             => $10::text
       )`,
      [
        user.tenantId,
        user.trabajadorId,
        dto.tipo,
        dto.fuente,
        dto.centroTrabajoId,
        dto.latitud,
        dto.longitud,
        dto.precisionMetros ?? null,
        ipOrigen,
        userAgent,
      ],
    );

    return rows[0];
  }

  /**
   * Lista las marcaciones del trabajador autenticado, ordenadas mas recientes
   * primero. RLS garantiza que solo vea las suyas (de su tenant).
   */
  async listarMias(
    user: JwtPayload,
    db: PoolClient,
    limit = 50,
  ): Promise<MarcacionRow[]> {
    if (!user.trabajadorId) {
      throw new ForbiddenException(
        'Solo trabajadores pueden consultar sus marcaciones.',
      );
    }

    const { rows } = await db.query<MarcacionRow>(
      `SELECT
         id, tenant_id, secuencia, trabajador_id, tipo, fuente,
         timestamp_utc, centro_trabajo_id, latitud, longitud,
         precision_metros, dentro_geocerca, hash_anterior, hash_actual
       FROM rc.marcaciones
       WHERE trabajador_id = $1::uuid
       ORDER BY timestamp_utc DESC
       LIMIT $2`,
      [user.trabajadorId, limit],
    );

    return rows;
  }
}
