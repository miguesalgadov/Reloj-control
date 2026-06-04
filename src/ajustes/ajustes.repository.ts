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
    tipo_marcacion?: string;
    timestamp_corregido?: string;
  };
  creado_por_id: string;
  creado_por_nombre: string;
  created_at: Date;
}

export interface AjusteDetalleRow extends AjusteRow {
  marcacion_original_completa: Record<string, unknown> | null;
  audit_log_id: string | null;
}

// Columnas comunes para listar y detalle
const SELECT_AJUSTE_COLS = `
  m.id, m.trabajador_id,
  t.rut                          AS trabajador_rut,
  t.nombres                      AS trabajador_nombres,
  t.apellido_paterno             AS trabajador_apellido_paterno,
  COALESCE(m.datos_ajuste->>'tipo_marcacion', m.tipo::text) AS tipo_marcacion,
  m.timestamp_utc,
  m.marcacion_original_id,
  m.datos_ajuste,
  (m.datos_ajuste->>'admin_id')        AS creado_por_id,
  (u.nombres || ' ' || u.apellidos)    AS creado_por_nombre,
  m.created_at
`;

// WHERE que identifica ajustes de los 3 sub-tipos (creacion usa tipo real, no 'ajuste')
const WHERE_ES_AJUSTE = `
  m.datos_ajuste IS NOT NULL
  AND (m.datos_ajuste->>'tipo_ajuste') IN ('creacion', 'correccion', 'anulacion')
`;

const JOINS_AJUSTE = `
  JOIN rc.trabajadores t ON t.id = m.trabajador_id
  JOIN rc.usuarios u ON u.id = (m.datos_ajuste->>'admin_id')::uuid
`;

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

  async findAdminNombre(adminId: string, db: PoolClient): Promise<string> {
    const { rows } = await db.query<{ nombre: string }>(
      `SELECT (nombres || ' ' || apellidos) AS nombre FROM rc.usuarios WHERE id = $1::uuid`,
      [adminId],
    );
    return rows[0]?.nombre ?? adminId;
  }

  async crearAjuste(
    opts: {
      trabajadorId: string;
      tipoMarcacion: string;
      timestampUtc: Date;
      latitud?: number | null;
      longitud?: number | null;
      marcacionOriginalId?: string | null;
      datosAjuste: object;
      adminId: string;
    },
    db: PoolClient,
  ): Promise<{ id: string; created_at: Date }> {
    const { rows } = await db.query<{ id: string; created_at: Date }>(
      `SELECT id, created_at
         FROM rc.registrar_ajuste(
           $1::rc.tipo_marcacion,
           $2::uuid,
           $3::timestamptz,
           $4::jsonb,
           $5::uuid,
           $6::numeric,
           $7::numeric,
           $8::uuid
         )`,
      [
        opts.tipoMarcacion,
        opts.trabajadorId,
        opts.timestampUtc.toISOString(),
        JSON.stringify(opts.datosAjuste),
        opts.marcacionOriginalId ?? null,
        opts.latitud ?? null,
        opts.longitud ?? null,
        opts.adminId,
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
        'marcacion_ajustada',
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
    const params = [
      filtros.trabajadorId ?? null,
      filtros.tipoAjuste ?? null,
      filtros.desde ?? null,
      filtros.hasta ?? null,
      filtros.creadoPorId ?? null,
    ];

    const whereExtra = `
      AND ($1::uuid IS NULL OR m.trabajador_id = $1::uuid)
      AND ($2::text IS NULL OR m.datos_ajuste->>'tipo_ajuste' = $2)
      AND ($3::date IS NULL OR (m.timestamp_utc AT TIME ZONE 'America/Santiago')::date >= $3::date)
      AND ($4::date IS NULL OR (m.timestamp_utc AT TIME ZONE 'America/Santiago')::date <= $4::date)
      AND ($5::uuid IS NULL OR (m.datos_ajuste->>'admin_id')::uuid = $5::uuid)
    `;

    const [countRes, dataRes] = await Promise.all([
      db.query<{ total: string }>(
        `SELECT COUNT(*)::text AS total
           FROM rc.marcaciones m
           ${JOINS_AJUSTE}
          WHERE ${WHERE_ES_AJUSTE} ${whereExtra}`,
        params,
      ),
      db.query<AjusteRow>(
        `SELECT ${SELECT_AJUSTE_COLS}
           FROM rc.marcaciones m
           ${JOINS_AJUSTE}
          WHERE ${WHERE_ES_AJUSTE} ${whereExtra}
          ORDER BY m.created_at DESC
          LIMIT $6 OFFSET $7`,
        [...params, filtros.limit, filtros.offset],
      ),
    ]);

    return { data: dataRes.rows, total: parseInt(countRes.rows[0].total, 10) };
  }

  async findById(id: string, db: PoolClient): Promise<AjusteDetalleRow | null> {
    const { rows } = await db.query<AjusteDetalleRow>(
      `SELECT
         ${SELECT_AJUSTE_COLS},
         CASE WHEN orig.id IS NOT NULL THEN
           jsonb_build_object(
             'id',               orig.id::text,
             'tipo',             orig.tipo::text,
             'fuente',           orig.fuente::text,
             'timestamp_utc',    orig.timestamp_utc,
             'latitud',          orig.latitud,
             'longitud',         orig.longitud,
             'dentro_geocerca',  orig.dentro_geocerca,
             'datos_ajuste',     orig.datos_ajuste,
             'created_at',       orig.created_at
           )
         ELSE NULL END AS marcacion_original_completa,
         al.id AS audit_log_id
       FROM rc.marcaciones m
       ${JOINS_AJUSTE}
       LEFT JOIN rc.marcaciones orig ON orig.id = m.marcacion_original_id
       LEFT JOIN LATERAL (
         SELECT id FROM rc.audit_log
          WHERE entidad_id = m.id AND categoria = 'marcacion_ajustada'
          ORDER BY created_at DESC LIMIT 1
       ) al ON true
      WHERE m.id = $1::uuid
        AND ${WHERE_ES_AJUSTE}`,
      [id],
    );
    return rows[0] ?? null;
  }
}
