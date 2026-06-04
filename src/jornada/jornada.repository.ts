import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { ConfiguracionJornada, JornadaPactadaVigente, MarcacionEvaluable } from './types';
import type { MarcacionConDatos } from './evaluator/marcaciones-efectivas';

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

interface JornadaRow {
  trabajador_id: string;
  tenant_id: string;
  contrato_id: string;
  horas_semanales_pactadas: number;
  permite_horas_extras: boolean;
  dia_semana: number;
  hora_inicio: string;
  hora_termino: string;
  colacion_inicio: string | null;
  colacion_termino: string | null;
  tolerancia_override: number | null;
}

interface MarcacionRow {
  id: string;
  tipo: MarcacionEvaluable['tipo'];
  timestamp_utc: Date;
  dentro_geocerca: boolean | null;
  marcacion_original_id: string | null;
  datos_ajuste: { tipo_ajuste?: 'creacion' | 'correccion' | 'anulacion' } | null;
}

@Injectable()
export class JornadaRepository {
  async getConfig(tenantId: string, db: PoolClient): Promise<ConfiguracionJornada> {
    const { rows } = await db.query<ConfiguracionRow>(
      `SELECT
         tolerancia_atraso_minutos,
         tolerancia_salida_anticipada_minutos,
         duracion_minima_colacion_minutos,
         duracion_maxima_colacion_minutos,
         colacion_es_imputable_jornada,
         umbral_inasistencia_sin_marcacion_horas,
         umbral_jornada_extendida_minutos,
         redondeo_horas_extra_minutos,
         redondeo_horas_extra_modo,
         dias_laborables
       FROM rc.configuracion_jornada
       WHERE tenant_id = $1::uuid`,
      [tenantId],
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

  async getJornadaPactada(
    tenantId: string,
    trabajadorId: string,
    diaSemana: number,
    db: PoolClient,
  ): Promise<JornadaPactadaVigente | null> {
    const { rows } = await db.query<JornadaRow>(
      `SELECT
         trabajador_id, tenant_id, contrato_id,
         horas_semanales_pactadas, permite_horas_extras,
         dia_semana, hora_inicio, hora_termino,
         colacion_inicio, colacion_termino,
         tolerancia_override
       FROM rc.v_jornada_vigente
       WHERE tenant_id = $1::uuid
         AND trabajador_id = $2::uuid
         AND dia_semana = $3`,
      [tenantId, trabajadorId, diaSemana],
    );

    if (rows.length === 0) return null;
    const r = rows[0];

    return {
      trabajadorId: r.trabajador_id,
      tenantId: r.tenant_id,
      contratoId: r.contrato_id,
      horasSemanalesPactadas: Number(r.horas_semanales_pactadas),
      permiteHorasExtras: r.permite_horas_extras,
      diaSemana: r.dia_semana,
      horaInicio: r.hora_inicio,
      horaTermino: r.hora_termino,
      colacionInicio: r.colacion_inicio,
      colacionTermino: r.colacion_termino,
      toleranciaOverride: r.tolerancia_override !== null ? Number(r.tolerancia_override) : null,
    };
  }

  async getMarcacionesDia(
    tenantId: string,
    trabajadorId: string,
    fechaStr: string,
    db: PoolClient,
  ): Promise<MarcacionConDatos[]> {
    const { rows } = await db.query<MarcacionRow>(
      `SELECT id, tipo, timestamp_utc, dentro_geocerca,
              marcacion_original_id, datos_ajuste
       FROM rc.marcaciones
       WHERE tenant_id = $1::uuid
         AND trabajador_id = $2::uuid
         AND (timestamp_utc AT TIME ZONE 'America/Santiago')::date = $3::date
       ORDER BY timestamp_utc`,
      [tenantId, trabajadorId, fechaStr],
    );

    return rows.map(r => ({
      id: r.id,
      tipo: r.tipo,
      timestampUtc: r.timestamp_utc,
      dentroGeocerca: r.dentro_geocerca,
      marcacionOriginalId: r.marcacion_original_id,
      datosAjuste: r.datos_ajuste,
    }));
  }

  async getMarcacionesSemana(
    tenantId: string,
    trabajadorId: string,
    lunesStr: string,
    domingoStr: string,
    db: PoolClient,
  ): Promise<Map<string, MarcacionConDatos[]>> {
    const { rows } = await db.query<MarcacionRow & { fecha_local: string }>(
      `SELECT
         id, tipo, timestamp_utc, dentro_geocerca,
         marcacion_original_id, datos_ajuste,
         (timestamp_utc AT TIME ZONE 'America/Santiago')::date::text AS fecha_local
       FROM rc.marcaciones
       WHERE tenant_id = $1::uuid
         AND trabajador_id = $2::uuid
         AND (timestamp_utc AT TIME ZONE 'America/Santiago')::date
             BETWEEN $3::date AND $4::date
       ORDER BY timestamp_utc`,
      [tenantId, trabajadorId, lunesStr, domingoStr],
    );

    const map = new Map<string, MarcacionConDatos[]>();
    for (const r of rows) {
      const list = map.get(r.fecha_local) ?? [];
      list.push({
        id: r.id,
        tipo: r.tipo,
        timestampUtc: r.timestamp_utc,
        dentroGeocerca: r.dentro_geocerca,
        marcacionOriginalId: r.marcacion_original_id,
        datosAjuste: r.datos_ajuste,
      });
      map.set(r.fecha_local, list);
    }
    return map;
  }
}
