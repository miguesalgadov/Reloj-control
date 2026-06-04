import { BadRequestException, Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { fromZonedTime, formatInTimeZone } from 'date-fns-tz';
import { getISODay, getDaysInMonth } from 'date-fns';
import { ReportesRepository, TrabajadorPeriodoRow, JornadaPeriodoRow, MarcacionPeriodoRow } from './reportes.repository';
import { evaluarJornadaDia } from '../jornada/evaluator/evaluador';
import { ConfiguracionJornada, JornadaPactadaVigente, MarcacionEvaluable } from '../jornada/types';
import type { ParamsReporteDto } from './dto/params-reporte.dto';
import type { FiltrosReporteDto } from './dto/filtros-reporte.dto';

const TZ = 'America/Santiago';
const LIMITE_TRABAJADORES = 500;

const NOMBRES_MES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

const DIAS_SEMANA_ES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const DIAS_CORTOS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

// ─── Helpers de fechas ───────────────────────────────────────────────────────

function pad2(n: number) { return String(n).padStart(2, '0'); }

function diasDelMes(año: number, mes: number): string[] {
  const total = getDaysInMonth(new Date(año, mes - 1));
  return Array.from({ length: total }, (_, i) => `${año}-${pad2(mes)}-${pad2(i + 1)}`);
}

function inicioMesUtc(año: number, mes: number): Date {
  return fromZonedTime(`${año}-${pad2(mes)}-01 00:00:00`, TZ);
}

function inicioMesSiguienteUtc(año: number, mes: number): Date {
  const nextMes = mes === 12 ? 1 : mes + 1;
  const nextAño = mes === 12 ? año + 1 : año;
  return fromZonedTime(`${nextAño}-${pad2(nextMes)}-01 00:00:00`, TZ);
}

function fechaTerminoMes(año: number, mes: number): string {
  const total = getDaysInMonth(new Date(año, mes - 1));
  return `${año}-${pad2(mes)}-${pad2(total)}`;
}

function diaSemanaLocal(fechaStr: string): number {
  const d = new Date(`${fechaStr}T12:00:00Z`);
  return getISODay(d);
}

function nombreMes(año: number, mes: number): string {
  return `${NOMBRES_MES[mes - 1]} ${año}`;
}

// ─── Helpers de mapas ────────────────────────────────────────────────────────

function buildJornadasMap(rows: JornadaPeriodoRow[]): Map<string, Map<number, JornadaPeriodoRow>> {
  const map = new Map<string, Map<number, JornadaPeriodoRow>>();
  for (const r of rows) {
    if (!map.has(r.contrato_id)) map.set(r.contrato_id, new Map());
    map.get(r.contrato_id)!.set(r.dia_semana, r);
  }
  return map;
}

function buildMarcacionesMap(rows: MarcacionPeriodoRow[]): Map<string, Map<string, MarcacionPeriodoRow[]>> {
  const map = new Map<string, Map<string, MarcacionPeriodoRow[]>>();
  for (const r of rows) {
    if (!map.has(r.trabajador_id)) map.set(r.trabajador_id, new Map());
    const m = r.timestamp_utc;
    const fechaStr = formatInTimeZone(m, TZ, 'yyyy-MM-dd');
    const lista = map.get(r.trabajador_id)!.get(fechaStr) ?? [];
    lista.push(r);
    map.get(r.trabajador_id)!.set(fechaStr, lista);
  }
  return map;
}

function getJornadaForDay(
  trab: TrabajadorPeriodoRow,
  fechaStr: string,
  jornadasPorContrato: Map<string, Map<number, JornadaPeriodoRow>>,
): JornadaPactadaVigente | null {
  if (!trab.contrato_id) return null;
  if (trab.contrato_inicio && trab.contrato_inicio > fechaStr) return null;
  if (trab.contrato_termino && trab.contrato_termino < fechaStr) return null;

  const dias = jornadasPorContrato.get(trab.contrato_id);
  if (!dias) return null;
  const diaSemana = diaSemanaLocal(fechaStr);
  const row = dias.get(diaSemana);
  if (!row) return null;

  return {
    trabajadorId: trab.id,
    tenantId: '',
    contratoId: trab.contrato_id,
    horasSemanalesPactadas: Number(trab.horas_semanales ?? 0),
    permiteHorasExtras: trab.permite_horas_extras ?? false,
    diaSemana,
    horaInicio: row.hora_inicio,
    horaTermino: row.hora_termino,
    colacionInicio: row.colacion_inicio,
    colacionTermino: row.colacion_termino,
    toleranciaOverride: row.tolerancia_minutos ?? null,
  };
}

function toMarcacionEvaluable(r: MarcacionPeriodoRow): MarcacionEvaluable {
  return { id: r.id, tipo: r.tipo, timestampUtc: r.timestamp_utc, dentroGeocerca: r.dentro_geocerca };
}

// ─── Tipos de salida ─────────────────────────────────────────────────────────

interface EvaluacionDia {
  fecha: string;
  dia_semana: string;
  es_laborable: boolean;
  en_periodo_trabajador: boolean;
  jornada_pactada: { hora_inicio: string; hora_termino: string; colacion_inicio: string | null; colacion_termino: string | null } | null;
  marcaciones: Array<{ tipo: string; hora_local: string; dentro_geocerca: boolean | null }>;
  evaluacion: {
    atraso_minutos: number;
    salida_anticipada_minutos: number;
    horas_trabajadas: number | null;
    horas_extra: number;
    inasistencia: boolean;
    observaciones: string;
  };
}

interface TotalesTrabajador {
  dias_trabajados: number;
  dias_ausente: number;
  horas_ordinarias_total: number;
  horas_extra_total: number;
  atrasos_total_minutos: number;
  atrasos_dias: number;
}

// ─── Validación ──────────────────────────────────────────────────────────────

function validarPeriodo(año: number, mes: number): void {
  const hoy = new Date();
  const añoActual = hoy.getFullYear();
  const mesActual = hoy.getMonth() + 1;
  if (año > añoActual || (año === añoActual && mes > mesActual)) {
    throw new BadRequestException('No se pueden generar reportes de períodos futuros.');
  }
}

// ─── Servicio ────────────────────────────────────────────────────────────────

@Injectable()
export class ReportesService {
  constructor(private readonly repo: ReportesRepository) {}

  // ─── Reporte 1: Asistencia detallada ──────────────────────────────────────

  async asistencia(params: ParamsReporteDto, filtros: FiltrosReporteDto, db: PoolClient) {
    const { anio: año, mes } = params;
    validarPeriodo(año, mes);

    const fechaInicio = `${año}-${pad2(mes)}-01`;
    const fechaFin = fechaTerminoMes(año, mes);

    const [tenant, config, trabajadores, jornadas, marcaciones] = await Promise.all([
      this.repo.getTenantInfo(db),
      this.repo.obtenerConfiguracion(db),
      this.repo.trabajadoresDelPeriodo(fechaInicio, fechaFin, filtros.trabajador_id ?? null, filtros.centro_trabajo_id ?? null, db),
      this.repo.jornadasDelPeriodo(fechaInicio, fechaFin, db),
      this.repo.marcacionesDelPeriodo(inicioMesUtc(año, mes), inicioMesSiguienteUtc(año, mes), db),
    ]);

    if (trabajadores.length > LIMITE_TRABAJADORES) {
      throw new BadRequestException(`Reporte demasiado grande (${trabajadores.length} trabajadores). Filtre por centro de trabajo.`);
    }

    const jornadasPorContrato = buildJornadasMap(jornadas);
    const marcacionesPorTrab = buildMarcacionesMap(marcaciones);
    const dias = diasDelMes(año, mes);
    const ahora = new Date();

    let totalesPeriodo = { trabajadores_evaluados: 0, total_horas_ordinarias: 0, total_horas_extra: 0, total_dias_trabajados: 0, total_atrasos_minutos: 0 };

    const trabajadoresData = trabajadores.map(trab => {
      const diasEval: EvaluacionDia[] = dias.map(fechaStr => {
        const enPeriodo = fechaStr >= (trab.fecha_ingreso ?? '') && (!trab.fecha_termino || fechaStr <= trab.fecha_termino);
        if (!enPeriodo) {
          return { fecha: fechaStr, dia_semana: DIAS_SEMANA_ES[diaSemanaLocal(fechaStr) - 1], es_laborable: false, en_periodo_trabajador: false, jornada_pactada: null, marcaciones: [], evaluacion: { atraso_minutos: 0, salida_anticipada_minutos: 0, horas_trabajadas: null, horas_extra: 0, inasistencia: false, observaciones: '—' } };
        }

        const jornada = getJornadaForDay(trab, fechaStr, jornadasPorContrato);
        const marcDia = (marcacionesPorTrab.get(trab.id)?.get(fechaStr) ?? []).map(toMarcacionEvaluable);
        const resultado = evaluarJornadaDia(marcDia, jornada, config, fechaStr, ahora);

        const horasExt = resultado.atraso !== null && !resultado.inasistencia.inasistencia
          ? Math.max(0, ((resultado.horasTrabajadas.horasTrabajadas ?? 0) - Number(trab.horas_semanales ?? 0) / 5))
          : 0;

        const obs: string[] = [];
        if (resultado.atraso?.esAtraso) obs.push(`Atraso ${resultado.atraso.minutosAtraso} min`);
        if (resultado.inasistencia.inasistencia) obs.push('Inasistencia');
        if (resultado.salidaAnticipada?.esSalidaAnticipada) obs.push(`Salida anticipada ${resultado.salidaAnticipada.minutosSalidaAnticipada} min`);

        return {
          fecha: fechaStr,
          dia_semana: DIAS_SEMANA_ES[diaSemanaLocal(fechaStr) - 1],
          es_laborable: resultado.esDiaLaborable,
          en_periodo_trabajador: true,
          jornada_pactada: jornada ? { hora_inicio: jornada.horaInicio.slice(0, 5), hora_termino: jornada.horaTermino.slice(0, 5), colacion_inicio: jornada.colacionInicio?.slice(0, 5) ?? null, colacion_termino: jornada.colacionTermino?.slice(0, 5) ?? null } : null,
          marcaciones: marcDia.map(m => ({
            tipo: m.tipo,
            hora_local: formatInTimeZone(m.timestampUtc, TZ, 'HH:mm'),
            dentro_geocerca: m.dentroGeocerca,
          })),
          evaluacion: {
            atraso_minutos: resultado.atraso?.minutosAtraso ?? 0,
            salida_anticipada_minutos: resultado.salidaAnticipada?.minutosSalidaAnticipada ?? 0,
            horas_trabajadas: resultado.horasTrabajadas.horasTrabajadas,
            horas_extra: horasExt,
            inasistencia: resultado.inasistencia.inasistencia,
            observaciones: obs.join('. ') || 'Sin observaciones.',
          },
        };
      });

      const totales: TotalesTrabajador = {
        dias_trabajados: diasEval.filter(d => d.en_periodo_trabajador && d.es_laborable && !d.evaluacion.inasistencia).length,
        dias_ausente: diasEval.filter(d => d.en_periodo_trabajador && d.es_laborable && d.evaluacion.inasistencia).length,
        horas_ordinarias_total: round2(diasEval.reduce((s, d) => s + (d.evaluacion.horas_trabajadas ?? 0), 0)),
        horas_extra_total: round2(diasEval.reduce((s, d) => s + d.evaluacion.horas_extra, 0)),
        atrasos_total_minutos: diasEval.reduce((s, d) => s + d.evaluacion.atraso_minutos, 0),
        atrasos_dias: diasEval.filter(d => d.evaluacion.atraso_minutos > 0).length,
      };

      totalesPeriodo.trabajadores_evaluados++;
      totalesPeriodo.total_horas_ordinarias += totales.horas_ordinarias_total;
      totalesPeriodo.total_horas_extra += totales.horas_extra_total;
      totalesPeriodo.total_dias_trabajados += totales.dias_trabajados;
      totalesPeriodo.total_atrasos_minutos += totales.atrasos_total_minutos;

      return {
        trabajador: { id: trab.id, rut: trab.rut, nombres: trab.nombres, apellido_paterno: trab.apellido_paterno, apellido_materno: trab.apellido_materno, centro_trabajo_nombre: trab.centro_trabajo_nombre },
        dias: diasEval,
        totales_mes: totales,
      };
    });

    return {
      periodo: { año, mes, nombre_mes: nombreMes(año, mes), fecha_inicio: fechaInicio, fecha_termino: fechaFin },
      tenant: { id: tenant?.id, razon_social: tenant?.razon_social },
      filtros: { trabajador_id: filtros.trabajador_id ?? null, centro_trabajo_id: filtros.centro_trabajo_id ?? null },
      trabajadores: trabajadoresData,
      totales_periodo: { ...totalesPeriodo, total_horas_ordinarias: round2(totalesPeriodo.total_horas_ordinarias), total_horas_extra: round2(totalesPeriodo.total_horas_extra) },
      generado_en: new Date().toISOString(),
    };
  }

  // ─── Reporte 2: Resumen por trabajador ────────────────────────────────────

  async resumenTrabajadores(params: ParamsReporteDto, filtros: FiltrosReporteDto, db: PoolClient) {
    const { anio: año, mes } = params;
    validarPeriodo(año, mes);

    const asistencia = await this.asistencia(params, { ...filtros, formato: 'json' }, db);
    const diasLaborablesTotal = asistencia.trabajadores[0]?.dias.filter(d => d.en_periodo_trabajador && d.es_laborable).length ?? 0;

    const trabajadores = asistencia.trabajadores.map(t => {
      const diasLab = t.dias.filter(d => d.en_periodo_trabajador && d.es_laborable).length;
      const promAtraso = t.totales_mes.atrasos_dias > 0
        ? round2(t.totales_mes.atrasos_total_minutos / t.totales_mes.atrasos_dias)
        : 0;
      const inasistencias = t.totales_mes.dias_ausente;
      const obs = inasistencias >= 2 ? `Trabajador con ${inasistencias} inasistencias no justificadas en el período.` : '';

      return {
        trabajador: {
          id: t.trabajador.id,
          rut: t.trabajador.rut,
          nombre_completo: [t.trabajador.nombres, t.trabajador.apellido_paterno, t.trabajador.apellido_materno].filter(Boolean).join(' '),
          centro_trabajo: t.trabajador.centro_trabajo_nombre,
        },
        totales: {
          dias_laborables_periodo: diasLab,
          dias_trabajados: t.totales_mes.dias_trabajados,
          dias_ausentes: t.totales_mes.dias_ausente,
          dias_atraso: t.totales_mes.atrasos_dias,
          horas_ordinarias: t.totales_mes.horas_ordinarias_total,
          horas_extra: t.totales_mes.horas_extra_total,
          atrasos_total_minutos: t.totales_mes.atrasos_total_minutos,
          promedio_atraso_minutos: promAtraso,
        },
        observaciones: obs,
      };
    });

    return {
      periodo: asistencia.periodo,
      tenant: asistencia.tenant,
      trabajadores,
      totales_periodo: asistencia.totales_periodo,
      generado_en: asistencia.generado_en,
    };
  }

  // ─── Reporte 3: Resumen por centro ────────────────────────────────────────

  async resumenCentros(params: ParamsReporteDto, filtros: FiltrosReporteDto, db: PoolClient) {
    const { anio: año, mes } = params;
    validarPeriodo(año, mes);

    const fechaInicio = `${año}-${pad2(mes)}-01`;
    const fechaFin = fechaTerminoMes(año, mes);
    const inicioUtc = inicioMesUtc(año, mes);
    const finUtc = inicioMesSiguienteUtc(año, mes);

    const [tenant, centros, asistencia] = await Promise.all([
      this.repo.getTenantInfo(db),
      this.repo.centrosActivos(db),
      this.asistencia(params, { formato: 'json' }, db),
    ]);

    const resumenPorCentro = new Map<string, {
      nombre: string; direccion: string | null;
      trabajadores: Set<string>;
      horas_ordinarias: number; horas_extra: number;
      dias_laborables: number; dias_trabajados: number;
      atrasos_minutos: number; fuera_geocerca: number;
    }>();

    for (const c of centros) {
      resumenPorCentro.set(c.id, { nombre: c.nombre, direccion: c.direccion, trabajadores: new Set(), horas_ordinarias: 0, horas_extra: 0, dias_laborables: 0, dias_trabajados: 0, atrasos_minutos: 0, fuera_geocerca: 0 });
    }

    for (const t of asistencia.trabajadores) {
      const centroId = asistencia.trabajadores.find(x => x.trabajador.id === t.trabajador.id) ? null : null;
      // Find centro from original data — we'll match by centro_trabajo_nombre
      const centroEntry = centros.find(c => c.nombre === t.trabajador.centro_trabajo_nombre);
      if (!centroEntry) continue;
      const entry = resumenPorCentro.get(centroEntry.id);
      if (!entry) continue;
      entry.trabajadores.add(t.trabajador.id);
      entry.horas_ordinarias += t.totales_mes.horas_ordinarias_total;
      entry.horas_extra += t.totales_mes.horas_extra_total;
      entry.dias_laborables += t.dias.filter(d => d.en_periodo_trabajador && d.es_laborable).length;
      entry.dias_trabajados += t.totales_mes.dias_trabajados;
      entry.atrasos_minutos += t.totales_mes.atrasos_total_minutos;
    }

    // Fetch fuera_geocerca counts per centro in parallel
    await Promise.all(
      centros.map(async c => {
        const entry = resumenPorCentro.get(c.id);
        if (!entry) return;
        entry.fuera_geocerca = await this.repo.countMarcacionesFueraGeocerca(inicioUtc, finUtc, c.id, db);
      }),
    );

    const centrosData = centros.map(c => {
      const e = resumenPorCentro.get(c.id)!;
      const asistenciaPct = e.dias_laborables > 0 ? round2((e.dias_trabajados / e.dias_laborables) * 100) : 0;
      return {
        centro: { id: c.id, nombre: c.nombre, direccion: c.direccion },
        trabajadores_activos: e.trabajadores.size,
        totales: {
          horas_ordinarias_total: round2(e.horas_ordinarias),
          horas_extra_total: round2(e.horas_extra),
          asistencia_promedio_porcentaje: asistenciaPct,
          atrasos_total_minutos: e.atrasos_minutos,
          marcajes_fuera_geocerca: e.fuera_geocerca,
        },
      };
    });

    const totTenant = {
      centros_activos: centros.length,
      horas_ordinarias_total: round2(centrosData.reduce((s, c) => s + c.totales.horas_ordinarias_total, 0)),
      horas_extra_total: round2(centrosData.reduce((s, c) => s + c.totales.horas_extra_total, 0)),
      asistencia_promedio_porcentaje: centrosData.length > 0
        ? round2(centrosData.reduce((s, c) => s + c.totales.asistencia_promedio_porcentaje, 0) / centrosData.length)
        : 0,
    };

    return {
      periodo: { año, mes, nombre_mes: nombreMes(año, mes), fecha_inicio: fechaInicio, fecha_termino: fechaFin },
      tenant: { id: tenant?.id, razon_social: tenant?.razon_social },
      centros: centrosData,
      totales_tenant: totTenant,
      generado_en: new Date().toISOString(),
    };
  }

  // ─── Reporte 4: Libro de asistencia ──────────────────────────────────────

  async libroAsistencia(params: ParamsReporteDto, filtros: FiltrosReporteDto, db: PoolClient) {
    const { anio: año, mes } = params;
    validarPeriodo(año, mes);

    const asistencia = await this.asistencia(params, { ...filtros, formato: 'json' }, db);
    const dias = diasDelMes(año, mes);

    const diasMes = dias.map(fechaStr => ({
      fecha: fechaStr,
      dia: parseInt(fechaStr.slice(8), 10),
      dia_semana: DIAS_CORTOS[diaSemanaLocal(fechaStr) - 1],
    }));

    const filas = asistencia.trabajadores.map(t => {
      const diasMap: Record<string, string> = {};
      let countP = 0, countA = 0, countNoLab = 0, countAtraso = 0;

      for (const d of t.dias) {
        let letra: string;
        if (!d.en_periodo_trabajador || !d.es_laborable) {
          letra = '—';
          countNoLab++;
        } else if (d.evaluacion.inasistencia) {
          letra = 'A';
          countA++;
        } else if (d.evaluacion.atraso_minutos > 0) {
          letra = 'T';
          countAtraso++;
          countP++; // T es presente con atraso
        } else {
          letra = 'P';
          countP++;
        }
        diasMap[d.fecha] = letra;
      }

      return {
        trabajador: {
          rut: t.trabajador.rut,
          nombre_completo: `${t.trabajador.apellido_paterno}, ${t.trabajador.nombres}`,
          centro_trabajo: t.trabajador.centro_trabajo_nombre,
        },
        dias: diasMap,
        totales: { P: countP, A: countA, '—': countNoLab, atraso: countAtraso },
      };
    });

    return {
      periodo: asistencia.periodo,
      tenant: asistencia.tenant,
      dias_mes: diasMes,
      filas,
      leyenda: { P: 'Presente', A: 'Ausente', T: 'Atraso (presente con atraso > tolerancia)', '—': 'No laborable / sin contrato' },
      generado_en: asistencia.generado_en,
    };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
