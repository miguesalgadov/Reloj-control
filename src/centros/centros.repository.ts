import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import type { CrearCentroDto } from './dto/crear-centro.dto';
import type { ActualizarCentroDto } from './dto/actualizar-centro.dto';

export interface CentroRow {
  id: string;
  nombre: string;
  codigo: string | null;
  direccion: string;
  comuna: string;
  region: string;
  latitud: number;
  longitud: number;
  radio_metros: number;
  estado: string;
  created_at: Date;
  updated_at: Date;
}

const CENTRO_COLS = `
  id, nombre, codigo, direccion, comuna, region,
  ST_Y(ubicacion::geometry) AS latitud,
  ST_X(ubicacion::geometry) AS longitud,
  radio_metros, estado, created_at, updated_at
`;

@Injectable()
export class CentrosRepository {
  async findAll(
    estado: string | undefined,
    limit: number,
    offset: number,
    db: PoolClient,
  ): Promise<{ data: CentroRow[]; total: number }> {
    const [countResult, rows] = await Promise.all([
      db.query<{ total: string }>(
        `SELECT COUNT(*)::text AS total
         FROM rc.centros_trabajo
         WHERE ($1::text IS NULL OR estado = $1)`,
        [estado ?? null],
      ),
      db.query<CentroRow>(
        `SELECT ${CENTRO_COLS}
         FROM rc.centros_trabajo
         WHERE ($1::text IS NULL OR estado = $1)
         ORDER BY nombre ASC
         LIMIT $2 OFFSET $3`,
        [estado ?? null, limit, offset],
      ),
    ]);

    return { data: rows.rows, total: parseInt(countResult.rows[0].total, 10) };
  }

  async findById(id: string, db: PoolClient): Promise<CentroRow | null> {
    const { rows } = await db.query<CentroRow>(
      `SELECT ${CENTRO_COLS} FROM rc.centros_trabajo WHERE id = $1::uuid`,
      [id],
    );
    return rows[0] ?? null;
  }

  async create(tenantId: string, dto: CrearCentroDto, db: PoolClient): Promise<CentroRow> {
    const { rows } = await db.query<CentroRow>(
      `INSERT INTO rc.centros_trabajo
         (tenant_id, nombre, codigo, direccion, comuna, region, ubicacion, radio_metros)
       VALUES ($1::uuid, $2, $3, $4, $5, $6,
               ST_SetSRID(ST_MakePoint($8::float8, $7::float8), 4326)::geography,
               $9)
       RETURNING ${CENTRO_COLS}`,
      [
        tenantId,
        dto.nombre,
        dto.codigo ?? null,
        dto.direccion,
        dto.comuna,
        dto.region,
        dto.latitud,
        dto.longitud,
        dto.radio_metros ?? 100,
      ],
    );
    return rows[0];
  }

  async update(id: string, dto: ActualizarCentroDto, db: PoolClient): Promise<CentroRow | null> {
    const sets: string[] = [];
    const params: unknown[] = [];

    if (dto.nombre !== undefined) {
      params.push(dto.nombre);
      sets.push(`nombre = $${params.length}`);
    }
    if (dto.codigo !== undefined) {
      params.push(dto.codigo);
      sets.push(`codigo = $${params.length}`);
    }
    if (dto.direccion !== undefined) {
      params.push(dto.direccion);
      sets.push(`direccion = $${params.length}`);
    }
    if (dto.comuna !== undefined) {
      params.push(dto.comuna);
      sets.push(`comuna = $${params.length}`);
    }
    if (dto.region !== undefined) {
      params.push(dto.region);
      sets.push(`region = $${params.length}`);
    }
    if (dto.radio_metros !== undefined) {
      params.push(dto.radio_metros);
      sets.push(`radio_metros = $${params.length}`);
    }

    // Coordenadas: update only if both lat and lng provided, or if ubicacion needs update
    const hasLat = dto.latitud !== undefined;
    const hasLng = dto.longitud !== undefined;
    if (hasLat || hasLng) {
      // If only one is provided, we need to read the current value first
      // Simpler: require both to be provided together for ubicacion updates
      if (hasLat && hasLng) {
        params.push(dto.latitud!, dto.longitud!);
        sets.push(
          `ubicacion = ST_SetSRID(ST_MakePoint($${params.length}::float8, $${params.length - 1}::float8), 4326)::geography`,
        );
      }
    }

    if (sets.length === 0) return this.findById(id, db);

    params.push(id);
    const { rows } = await db.query<CentroRow>(
      `UPDATE rc.centros_trabajo SET ${sets.join(', ')}, updated_at = now()
       WHERE id = $${params.length}::uuid
       RETURNING ${CENTRO_COLS}`,
      params,
    );
    return rows[0] ?? null;
  }

  async inactivar(id: string, db: PoolClient): Promise<CentroRow | null> {
    const { rows } = await db.query<CentroRow>(
      `UPDATE rc.centros_trabajo SET estado = 'inactivo', updated_at = now()
       WHERE id = $1::uuid
       RETURNING ${CENTRO_COLS}`,
      [id],
    );
    return rows[0] ?? null;
  }

  async countTrabajadoresActivos(centroId: string, db: PoolClient): Promise<number> {
    const { rows } = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM rc.trabajadores
       WHERE centro_trabajo_id = $1::uuid AND estado = 'activo'`,
      [centroId],
    );
    return parseInt(rows[0].count, 10);
  }
}
