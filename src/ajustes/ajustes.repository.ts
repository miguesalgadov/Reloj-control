import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';

export interface MarcacionOriginalRow {
  id: string;
  trabajador_id: string;
  tipo: string;
  timestamp_utc: Date;
  dentro_geocerca: boolean | null;
  datos_ajuste: { tipo_ajuste?: string } | null;
  anulada: boolean;
}

export interface AjusteRow {
  id: string;
  trabajador_id: string;
  trabajador_rut: string;
  trabajador_nombres: string;
  trabajador_apellido_paterno: string;
  tipo_marcacion: string;
  timestamp_utc: Date;
  marcacion_original_id: string | null;
  datos_ajuste: {
    tipo_ajuste: string;
    motivo: string;
    admin_id: string;
    timestamp_corregido?: string;
  };
  creado_por_id: string;
  creado_por_nombre: string;
  created_at: Date;
}

@Injectable()
export class AjustesRepository {
  async findMarcacionOriginal(
    marcacionId: string,
    db: PoolClient,
  ): Promise<MarcacionOriginalRow | null> {
    const { rows } = await db.query<MarcacionOriginalRow>(
      `SELECT
         m.id, m.trabajador_id, m.tipo,
         m.timestamp_utc, m.dentro_geocerca,
         m.datos_ajuste,
         EXISTS (
           SELECT 1 FROM rc.marcaciones a
            WHERE a.marcacion_original_id = m.id
              AND a.tipo = 'ajuste'
              AND (a.datos_ajuste->>'tipo_ajuste') = 'anulacion'
         ) AS anulada
       FROM rc.marcaciones m
      WHERE m.id = $1::uuid`,
      [marcacionId],
    );
    return rows[0] ?? null;
  }

  async existeTrabajador(trabajadorId: string, db: PoolClient): Promise<boolean> {
    const { rows } = await db.query<{ existe: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM rc.trabajadores WHERE id = $1::uuid) AS existe`,
      [trabajadorId],
    );
    return rows[0].existe;
  }

  async crearAjuste(
    opts: {
      trabajadorId: string;
      tipoMarcacion: string;
      timestampUtc: Date;
      latitud?: number | null;
      longitud?: number | null;
      centroTrabajoId?: string | null;
      marcacionOriginalId?: string | null;
      datosAjuste: object;
      adminId: string;
    },
    db: PoolClient,
  ): Promise<{ id: string; created_at: Date }> {
    const { rows } = await db.query<{ id: string; created_at: Date }>(
      `INSERT INTO rc.marcaciones
         (tenant_id, trabajador_id, tipo, timestamp_utc,
          latitud, longitud, dentro_geocerca,
          marcacion_original_id, datos_ajuste)
       SELECT
         rc.current_tenant_id(),
         $1::uuid,
         'ajuste',
         $2::timestamptz,
         $3::numeric,
         $4::numeric,
         NULL,
         $5::uuid,
         $6::jsonb
       RETURNING id, created_at`,
      [
        opts.trabajadorId,
        opts.timestampUtc.toISOString(),
        opts.latitud ?? null,
        opts.longitud ?? null,
        opts.marcacionOriginalId ?? null,
        JSON.stringify(opts.datosAjuste),
      ],
    );
    return rows[0];
  }

  async registrarAuditoria(
    opts: {
      tenantId: string;
      adminId: string;
      ajusteId: string;
      payload: object;
    },
    db: PoolClient,
  ): Promise<void> {
    await db.query(
      `SELECT rc.registrar_evento(
         $1::uuid, $2::rc.audit_categoria, $3, $4::rc.audit_actor_tipo,
         $5, $5, $6, $7::uuid, $8::jsonb
       )`,
      [
        opts.tenantId,
        'ajuste_marcacion',
        'crear_ajuste',
        'usuario',
        opts.adminId,
        'marcacion',
        opts.ajusteId,
        JSON.stringify(opts.payload),
      ],
    );
  }

  async listar(
    filtros: {
      trabajadorId?: string;
      tipoAjuste?: string;
      desde?: string;
      hasta?: string;
      creadoPorId?: string;
      limit: number;
      offset: number;
    },
    db: PoolClient,
  ): Promise<{ data: AjusteRow[]; total: number }> {
    const [countRes, dataRes] = await Promise.all([
      db.query<{ total: string }>(
        `SELECT COUNT(*)::text AS total
           FROM rc.marcaciones m
           JOIN rc.trabajadores t ON t.id = m.trabajador_id
           JOIN rc.usuarios u ON u.id = (m.datos_ajuste->>'admin_id')::uuid
          WHERE m.tipo = 'ajuste'
            AND ($1::uuid IS NULL OR m.trabajador_id = $1::uuid)
            AND ($2::text IS NULL OR m.datos_ajuste->>'tipo_ajuste' = $2)
            AND ($3::date IS NULL OR (m.timestamp_utc AT TIME ZONE 'America/Santiago')::date >= $3::date)
            AND ($4::date IS NULL OR (m.timestamp_utc AT TIME ZONE 'America/Santiago')::date <= $4::date)
            AND ($5::uuid IS NULL OR (m.datos_ajuste->>'admin_id')::uuid = $5::uuid)`,
        [filtros.trabajadorId ?? null, filtros.tipoAjuste ?? null, filtros.desde ?? null, filtros.hasta ?? null, filtros.creadoPorId ?? null],
      ),
      db.query<AjusteRow>(
        `SELECT
           m.id, m.trabajador_id,
           t.rut                   AS trabajador_rut,
           t.nombres               AS trabajador_nombres,
           t.apellido_paterno      AS trabajador_apellido_paterno,
           m.tipo                  AS tipo_marcacion,
           m.timestamp_utc,
           m.marcacion_original_id,
           m.datos_ajuste,
           (m.datos_ajuste->>'admin_id') AS creado_por_id,
           (u.nombres || ' ' || u.apellidos) AS creado_por_nombre,
           m.created_at
           FROM rc.marcaciones m
           JOIN rc.trabajadores t ON t.id = m.trabajador_id
           JOIN rc.usuarios u ON u.id = (m.datos_ajuste->>'admin_id')::uuid
          WHERE m.tipo = 'ajuste'
            AND ($1::uuid IS NULL OR m.trabajador_id = $1::uuid)
            AND ($2::text IS NULL OR m.datos_ajuste->>'tipo_ajuste' = $2)
            AND ($3::date IS NULL OR (m.timestamp_utc AT TIME ZONE 'America/Santiago')::date >= $3::date)
            AND ($4::date IS NULL OR (m.timestamp_utc AT TIME ZONE 'America/Santiago')::date <= $4::date)
            AND ($5::uuid IS NULL OR (m.datos_ajuste->>'admin_id')::uuid = $5::uuid)
          ORDER BY m.created_at DESC
          LIMIT $6 OFFSET $7`,
        [filtros.trabajadorId ?? null, filtros.tipoAjuste ?? null, filtros.desde ?? null, filtros.hasta ?? null, filtros.creadoPorId ?? null, filtros.limit, filtros.offset],
      ),
    ]);
    return { data: dataRes.rows, total: parseInt(countRes.rows[0].total, 10) };
  }

  async findById(id: string, db: PoolClient): Promise<AjusteRow | null> {
    const { rows } = await db.query<AjusteRow>(
      `SELECT
         m.id, m.trabajador_id,
         t.rut                   AS trabajador_rut,
         t.nombres               AS trabajador_nombres,
         t.apellido_paterno      AS trabajador_apellido_paterno,
         m.tipo                  AS tipo_marcacion,
         m.timestamp_utc,
         m.marcacion_original_id,
         m.datos_ajuste,
         (m.datos_ajuste->>'admin_id') AS creado_por_id,
         (u.nombres || ' ' || u.apellidos) AS creado_por_nombre,
         m.created_at
         FROM rc.marcaciones m
         JOIN rc.trabajadores t ON t.id = m.trabajador_id
         JOIN rc.usuarios u ON u.id = (m.datos_ajuste->>'admin_id')::uuid
        WHERE m.id = $1::uuid
          AND m.tipo = 'ajuste'`,
      [id],
    );
    return rows[0] ?? null;
  }
}
