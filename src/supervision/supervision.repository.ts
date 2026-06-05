import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { ConfiguracionJornada } from '../jornada/types';

export interface TrabajadorDiaRow {
  trabajador_id: string;
  rut: string;
  nombres: string;
  apellido_paterno: string;
  apellido_materno: string | null;
  centro_trabajo_id: string | null;
  centro_trabajo_nombre: string | null;
  // Contract (null = sin contrato vigente)
  contrato_id: string | null;
  // Jornada del día (null = no laborable o sin contrato)
  dia_semana: number | null;
  hora_inicio: string | null;
  hora_termino: string | null;
  colacion_inicio: string | null;
  colacion_termino: string | null;
  tolerancia_override: number | null;
  horas_semanales_pactadas: number | null;
  permite_horas_extras: boolean | null;
}

export interface MarcacionDiaRow {
  id: string;
  trabajador_id: string;
  tipo: 'entrada' | 'salida' | 'inicio_colacion' | 'fin_colacion' | 'ajuste';
  timestamp_utc: Date;
  dentro_geocerca: boolean | null;
  marcacion_original_id?: string | null;
  datos_ajuste?: { tipo_ajuste?: 'creacion' | 'correccion' | 'anulacion' } | null;
}

export interface AlertaInasistenciaRow {
  trabajador_id: string;
  rut: string;
  nombres: string;
  apellido_paterno: string;
  centro_trabajo_id: string | null;
  centro_trabajo_nombre: string | null;
  hora_inicio: string;
  umbral_horas: number;
  horas_desde_inicio: number;
  registrado_en: Date;
}

export interface AlertaGeoRow {
  marcacion_id: string;
  tipo_marcacion: string;
  timestamp_utc: Date;
  trabajador_id: string;
  rut: string;
  nombres: string;
  apellido_paterno: string;
  centro_trabajo_id: string | null;
  centro_trabajo_nombre: string | null;
  centro_asignado: string | null;
  distancia_metros: number | null;
}

export interface AlertaAtrasoRow {
  trabajador_id: string;
  rut: string;
  nombres: string;
  apellido_paterno: string;
  centro_trabajo_id: string | null;
  centro_trabajo_nombre: string | null;
  dias_con_atraso: number;
  promedio_minutos: number;
  ultima_fecha: string;
}

export interface AlertaColacionRow {
  trabajador_id: string;
  rut: string;
  nombres: string;
  apellido_paterno: string;
  centro_trabajo_id: string | null;
  centro_trabajo_nombre: string | null;
  colacion_inicio: string;
  minutos_pasados: number;
}

interface ConfiguracionRow {
  tolerancia_atraso_minutos: number;
  tolerancia_salida_anticipada_minutos: number;
  duracion_minima_colacion_minutos: number;
  duracion_maxima_colacion_minutos: number;
  colacion_es_imputable_jornada: boolean;
  umbral_inasistencia_sin_marcacion_horas: number;
  umbral_jornada_extendida_minutos: number;
  redondeo_horas_extra_minutos: number;
  redondeo_horas_extra_modo: 'abajo' | 'arriba' | 'cercano';
  dias_laborables: number[];
}

@Injectable()
export class SupervisionRepository {
  async obtenerConfiguracion(db: PoolClient): Promise<ConfiguracionJornada> {
    const { rows } = await db.query<ConfiguracionRow>(
      `SELECT tolerancia_atraso_minutos, tolerancia_salida_anticipada_minutos,
              duracion_minima_colacion_minutos, duracion_maxima_colacion_minutos,
              colacion_es_imputable_jornada, umbral_inasistencia_sin_marcacion_horas,
              umbral_jornada_extendida_minutos, redondeo_horas_extra_minutos,
              redondeo_horas_extra_modo, dias_laborables
         FROM rc.configuracion_jornada
        WHERE tenant_id = rc.current_tenant_id()`,
      [],
    );
    const r = rows[0];
    return {
      toleranciaAtrasoMinutos: r.tolerancia_atraso_minutos,
      toleranciaSalidaAnticipadaMinutos: r.tolerancia_salida_anticipada_minutos,
      duracionMinimaColacionMinutos: r.duracion_minima_colacion_minutos,
      duracionMaximaColacionMinutos: r.duracion_maxima_colacion_minutos,
      colacionEsImputableJornada: r.colacion_es_imputable_jornada,
      umbralInasistenciaSinMarcacionHoras: r.umbral_inasistencia_sin_marcacion_horas,
      umbralJornadaExtendidaMinutos: r.umbral_jornada_extendida_minutos,
      redondeoHorasExtraMinutos: r.redondeo_horas_extra_minutos,
      redondeoHorasExtraModo: r.redondeo_horas_extra_modo,
      diasLaborables: r.dias_laborables,
    };
  }

  async trabajadoresConJornadaDelDia(
    diaSemana: number,
    centroId: string | null,
    db: PoolClient,
  ): Promise<TrabajadorDiaRow[]> {
    const { rows } = await db.query<TrabajadorDiaRow>(
      `SELECT
         t.id                      AS trabajador_id,
         t.rut,
         t.nombres,
         t.apellido_paterno,
         t.apellido_materno,
         t.centro_trabajo_id,
         ct.nombre                 AS centro_trabajo_nombre,
         c.id                      AS contrato_id,
         vj.dia_semana,
         vj.hora_inicio::text,
         vj.hora_termino::text,
         vj.colacion_inicio::text,
         vj.colacion_termino::text,
         vj.tolerancia_override,
         vj.horas_semanales_pactadas,
         vj.permite_horas_extras
       FROM rc.trabajadores t
       LEFT JOIN rc.centros_trabajo ct ON ct.id = t.centro_trabajo_id
       LEFT JOIN rc.contratos c
              ON c.trabajador_id = t.id AND c.estado = 'vigente'
       LEFT JOIN rc.v_jornada_vigente vj
              ON vj.trabajador_id = t.id
             AND vj.tenant_id = rc.current_tenant_id()
             AND vj.dia_semana = $1::smallint
       WHERE t.estado = 'activo'
         AND ($2::uuid IS NULL OR t.centro_trabajo_id = $2::uuid)
       ORDER BY t.apellido_paterno, t.nombres`,
      [diaSemana, centroId],
    );
    return rows;
  }

  async marcacionesDelDia(fechaStr: string, db: PoolClient): Promise<MarcacionDiaRow[]> {
    const { rows } = await db.query<MarcacionDiaRow>(
      `SELECT id, trabajador_id, tipo, timestamp_utc, dentro_geocerca,
              marcacion_original_id, datos_ajuste
         FROM rc.marcaciones
        WHERE (timestamp_utc AT TIME ZONE 'America/Santiago')::date = $1::date
        ORDER BY trabajador_id, timestamp_utc`,
      [fechaStr],
    );
    return rows;
  }

  async existeTrabajador(id: string, db: PoolClient): Promise<boolean> {
    const { rows } = await db.query<{ existe: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM rc.trabajadores WHERE id = $1::uuid) AS existe`,
      [id],
    );
    return rows[0].existe;
  }

  async alertasInasistenciaPresunta(
    umbralHoras: number,
    db: PoolClient,
  ): Promise<AlertaInasistenciaRow[]> {
    const { rows } = await db.query<AlertaInasistenciaRow>(
      `SELECT
         t.id                    AS trabajador_id,
         t.rut,
         t.nombres,
         t.apellido_paterno,
         t.centro_trabajo_id,
         ct.nombre               AS centro_trabajo_nombre,
         vj.hora_inicio::text,
         $1::numeric             AS umbral_horas,
         GREATEST(0, EXTRACT(EPOCH FROM (
           (now() AT TIME ZONE 'America/Santiago')::time - vj.hora_inicio
         )) / 3600.0)            AS horas_desde_inicio,
         now()                   AS registrado_en
       FROM rc.trabajadores t
       JOIN rc.v_jornada_vigente vj
              ON vj.trabajador_id = t.id
             AND vj.tenant_id = rc.current_tenant_id()
             AND vj.dia_semana = EXTRACT(ISODOW FROM (now() AT TIME ZONE 'America/Santiago'))::int
       LEFT JOIN rc.centros_trabajo ct ON ct.id = t.centro_trabajo_id
       WHERE t.estado = 'activo'
         AND (now() AT TIME ZONE 'America/Santiago')::time
             > (vj.hora_inicio + ($1 || ' hours')::interval)
         AND NOT EXISTS (
           SELECT 1 FROM rc.marcaciones m
            WHERE m.trabajador_id = t.id
              AND m.tipo = 'entrada'
              AND (m.timestamp_utc AT TIME ZONE 'America/Santiago')::date
                  = (now() AT TIME ZONE 'America/Santiago')::date
         )`,
      [umbralHoras],
    );
    return rows;
  }

  async alertasFueraGeocerca(
    desdeUtc: string,
    hastaUtc: string,
    db: PoolClient,
  ): Promise<AlertaGeoRow[]> {
    const { rows } = await db.query<AlertaGeoRow>(
      `SELECT
         m.id                    AS marcacion_id,
         m.tipo                  AS tipo_marcacion,
         m.timestamp_utc,
         t.id                    AS trabajador_id,
         t.rut,
         t.nombres,
         t.apellido_paterno,
         t.centro_trabajo_id,
         ct.nombre               AS centro_trabajo_nombre,
         ctrab.nombre            AS centro_asignado,
         CASE
           WHEN m.ubicacion IS NOT NULL AND ctrab.ubicacion IS NOT NULL
           THEN ST_Distance(m.ubicacion::geography, ctrab.ubicacion::geography)::int
         END                     AS distancia_metros
       FROM rc.marcaciones m
       JOIN rc.trabajadores t   ON t.id = m.trabajador_id
       LEFT JOIN rc.centros_trabajo ct    ON ct.id = t.centro_trabajo_id
       LEFT JOIN rc.centros_trabajo ctrab ON ctrab.id = m.centro_trabajo_id
       WHERE m.dentro_geocerca = false
         AND m.timestamp_utc >= $1::timestamptz
         AND m.timestamp_utc <  $2::timestamptz
       ORDER BY m.timestamp_utc DESC`,
      [desdeUtc, hastaUtc],
    );
    return rows;
  }

  async alertasAtrasoRecurrente(
    umbralMinutos: number,
    umbralDias: number,
    db: PoolClient,
  ): Promise<AlertaAtrasoRow[]> {
    const { rows } = await db.query<AlertaAtrasoRow>(
      `WITH atrasos_por_dia AS (
         SELECT
           m.trabajador_id,
           DATE(m.timestamp_utc AT TIME ZONE 'America/Santiago') AS fecha_local,
           EXTRACT(EPOCH FROM (
             (m.timestamp_utc AT TIME ZONE 'America/Santiago')::time
             - vj.hora_inicio
           )) / 60.0 AS minutos_atraso
           FROM rc.marcaciones m
           JOIN rc.v_jornada_vigente vj
                  ON vj.trabajador_id = m.trabajador_id
                 AND vj.tenant_id = rc.current_tenant_id()
                 AND vj.dia_semana = EXTRACT(ISODOW FROM (m.timestamp_utc AT TIME ZONE 'America/Santiago'))::int
          WHERE m.tipo = 'entrada'
            AND m.timestamp_utc >= (now() - interval '30 days')
            AND m.timestamp_utc <  now()
       ),
       agregados AS (
         SELECT
           trabajador_id,
           COUNT(*)              AS dias_con_atraso,
           AVG(minutos_atraso)::int AS promedio_minutos,
           MAX(fecha_local)::text   AS ultima_fecha
           FROM atrasos_por_dia
          WHERE minutos_atraso > $1
          GROUP BY trabajador_id
         HAVING COUNT(*) >= $2
       )
       SELECT
         t.id                    AS trabajador_id,
         t.rut,
         t.nombres,
         t.apellido_paterno,
         t.centro_trabajo_id,
         ct.nombre               AS centro_trabajo_nombre,
         a.dias_con_atraso::int,
         a.promedio_minutos,
         a.ultima_fecha
         FROM agregados a
         JOIN rc.trabajadores t ON t.id = a.trabajador_id
         LEFT JOIN rc.centros_trabajo ct ON ct.id = t.centro_trabajo_id`,
      [umbralMinutos, umbralDias],
    );
    return rows;
  }

  async alertasColacionNoMarcada(db: PoolClient): Promise<AlertaColacionRow[]> {
    const { rows } = await db.query<AlertaColacionRow>(
      `SELECT
         t.id                    AS trabajador_id,
         t.rut,
         t.nombres,
         t.apellido_paterno,
         t.centro_trabajo_id,
         ct.nombre               AS centro_trabajo_nombre,
         vj.colacion_inicio::text,
         EXTRACT(EPOCH FROM (
           (now() AT TIME ZONE 'America/Santiago')::time
           - (vj.colacion_inicio + interval '15 minutes')
         )) / 60.0               AS minutos_pasados
       FROM rc.trabajadores t
       JOIN rc.v_jornada_vigente vj
              ON vj.trabajador_id = t.id
             AND vj.tenant_id = rc.current_tenant_id()
             AND vj.dia_semana = EXTRACT(ISODOW FROM (now() AT TIME ZONE 'America/Santiago'))::int
       LEFT JOIN rc.centros_trabajo ct ON ct.id = t.centro_trabajo_id
       WHERE t.estado = 'activo'
         AND vj.colacion_inicio IS NOT NULL
         AND (now() AT TIME ZONE 'America/Santiago')::time
             > (vj.colacion_inicio + interval '15 minutes')
         AND NOT EXISTS (
           SELECT 1 FROM rc.marcaciones m
            WHERE m.trabajador_id = t.id
              AND m.tipo = 'inicio_colacion'
              AND (m.timestamp_utc AT TIME ZONE 'America/Santiago')::date
                  = (now() AT TIME ZONE 'America/Santiago')::date
         )`,
      [],
    );
    return rows;
  }
}
