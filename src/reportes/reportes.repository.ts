import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { ConfiguracionJornada } from '../jornada/types';

export interface TenantInfo { id: string; razon_social: string; }

export interface TrabajadorPeriodoRow {
  id: string;
  rut: string;
  nombres: string;
  apellido_paterno: string;
  apellido_materno: string | null;
  fecha_ingreso: string;
  fecha_termino: string | null;
  estado: string;
  centro_trabajo_id: string | null;
  centro_trabajo_nombre: string | null;
  contrato_id: string | null;
  cargo: string | null;
  tipo_contrato: string | null;
  horas_semanales: number | null;
  permite_horas_extras: boolean | null;
  contrato_inicio: string | null;
  contrato_termino: string | null;
}

export interface JornadaPeriodoRow {
  contrato_id: string;
  dia_semana: number;
  hora_inicio: string;
  hora_termino: string;
  colacion_inicio: string | null;
  colacion_termino: string | null;
  tolerancia_minutos: number;
}

export interface MarcacionPeriodoRow {
  id: string;
  trabajador_id: string;
  tipo: 'entrada' | 'salida' | 'inicio_colacion' | 'fin_colacion' | 'ajuste';
  timestamp_utc: Date;
  dentro_geocerca: boolean | null;
  marcacion_original_id?: string | null;
  datos_ajuste?: { tipo_ajuste?: 'creacion' | 'correccion' | 'anulacion' } | null;
}

export interface CentroRow {
  id: string;
  nombre: string;
  direccion: string | null;
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
export class ReportesRepository {
  async getTenantInfo(db: PoolClient): Promise<TenantInfo> {
    const { rows } = await db.query<TenantInfo>(
      `SELECT id, razon_social FROM rc.tenants WHERE id = rc.current_tenant_id()`,
    );
    return rows[0];
  }

  async obtenerConfiguracion(db: PoolClient): Promise<ConfiguracionJornada> {
    const { rows } = await db.query<ConfiguracionRow>(
      `SELECT tolerancia_atraso_minutos, tolerancia_salida_anticipada_minutos,
              duracion_minima_colacion_minutos, duracion_maxima_colacion_minutos,
              colacion_es_imputable_jornada, umbral_inasistencia_sin_marcacion_horas,
              umbral_jornada_extendida_minutos, redondeo_horas_extra_minutos,
              redondeo_horas_extra_modo, dias_laborables
         FROM rc.configuracion_jornada
        WHERE tenant_id = rc.current_tenant_id()`,
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

  async trabajadoresDelPeriodo(
    fechaInicioMes: string,
    fechaTerminoMes: string,
    filtroTrabajadorId: string | null,
    filtroCentroId: string | null,
    db: PoolClient,
  ): Promise<TrabajadorPeriodoRow[]> {
    const { rows } = await db.query<TrabajadorPeriodoRow>(
      `SELECT
         t.id, t.rut, t.nombres, t.apellido_paterno, t.apellido_materno,
         t.fecha_ingreso::text, t.fecha_termino::text, t.estado,
         t.centro_trabajo_id,
         ct.nombre               AS centro_trabajo_nombre,
         c.id                    AS contrato_id,
         c.cargo,
         c.tipo_contrato,
         c.horas_semanales,
         c.permite_horas_extras,
         c.fecha_inicio::text    AS contrato_inicio,
         c.fecha_termino::text   AS contrato_termino
       FROM rc.trabajadores t
       LEFT JOIN rc.centros_trabajo ct ON ct.id = t.centro_trabajo_id
       LEFT JOIN rc.contratos c
              ON c.trabajador_id = t.id
             AND c.estado IN ('vigente', 'terminado')
             AND c.fecha_inicio::date <= $2::date
             AND (c.fecha_termino IS NULL OR c.fecha_termino::date >= $1::date)
       WHERE t.fecha_ingreso::date <= $2::date
         AND (t.fecha_termino IS NULL OR t.fecha_termino::date >= $1::date)
         AND ($3::uuid IS NULL OR t.id = $3::uuid)
         AND ($4::uuid IS NULL OR t.centro_trabajo_id = $4::uuid)
       ORDER BY t.apellido_paterno, t.nombres`,
      [fechaInicioMes, fechaTerminoMes, filtroTrabajadorId, filtroCentroId],
    );
    return rows;
  }

  async jornadasDelPeriodo(
    fechaInicioMes: string,
    fechaTerminoMes: string,
    db: PoolClient,
  ): Promise<JornadaPeriodoRow[]> {
    const { rows } = await db.query<JornadaPeriodoRow>(
      `SELECT
         jp.contrato_id, jp.dia_semana,
         jp.hora_inicio::text,   jp.hora_termino::text,
         jp.colacion_inicio::text, jp.colacion_termino::text,
         jp.tolerancia_minutos
       FROM rc.jornadas_pactadas jp
       JOIN rc.contratos c ON c.id = jp.contrato_id
       WHERE c.fecha_inicio::date <= $2::date
         AND (c.fecha_termino IS NULL OR c.fecha_termino::date >= $1::date)`,
      [fechaInicioMes, fechaTerminoMes],
    );
    return rows;
  }

  async marcacionesDelPeriodo(
    inicioUtc: Date,
    finUtc: Date,
    db: PoolClient,
  ): Promise<MarcacionPeriodoRow[]> {
    const { rows } = await db.query<MarcacionPeriodoRow>(
      `SELECT id, trabajador_id, tipo, timestamp_utc, dentro_geocerca,
              marcacion_original_id, datos_ajuste
         FROM rc.marcaciones
        WHERE timestamp_utc >= $1::timestamptz
          AND timestamp_utc <  $2::timestamptz
        ORDER BY trabajador_id, timestamp_utc`,
      [inicioUtc.toISOString(), finUtc.toISOString()],
    );
    return rows;
  }

  async centrosActivos(db: PoolClient): Promise<CentroRow[]> {
    const { rows } = await db.query<CentroRow>(
      `SELECT id, nombre, direccion FROM rc.centros_trabajo WHERE estado = 'activo' ORDER BY nombre`,
    );
    return rows;
  }

  async countMarcacionesFueraGeocerca(
    inicioUtc: Date,
    finUtc: Date,
    centroId: string,
    db: PoolClient,
  ): Promise<number> {
    const { rows } = await db.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total
         FROM rc.marcaciones m
         JOIN rc.trabajadores t ON t.id = m.trabajador_id
        WHERE m.dentro_geocerca = false
          AND m.timestamp_utc >= $1::timestamptz
          AND m.timestamp_utc <  $2::timestamptz
          AND t.centro_trabajo_id = $3::uuid`,
      [inicioUtc.toISOString(), finUtc.toISOString(), centroId],
    );
    return parseInt(rows[0].total, 10);
  }
}
