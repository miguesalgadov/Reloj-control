import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { formatInTimeZone } from 'date-fns-tz';
import {
  SupervisionRepository,
  TrabajadorDiaRow,
  MarcacionDiaRow,
} from './supervision.repository';
import { JornadaService } from '../jornada/jornada.service';
import { evaluarJornadaDia } from '../jornada/evaluator/evaluador';
import { diaSemanaIso, fechaLocalChile, toLocalChile } from '../jornada/evaluator/utils';
import {
  ConfiguracionJornada,
  JornadaPactadaVigente,
  MarcacionEvaluable,
  ResultadoJornadaDia,
  ResultadoSemana,
} from '../jornada/types';
import type { ListarDiaDto } from './dto/listar-dia.dto';
import type { ListarAlertasDto, TipoAlerta } from './dto/listar-alertas.dto';

export type EstadoDia = 'presente' | 'atraso' | 'ausente' | 'esperando' | 'no_laborable' | 'sin_contrato';

export function derivarEstadoDia(
  contratoId: string | null,
  evaluacion: ResultadoJornadaDia,
  marcaciones: MarcacionEvaluable[],
): EstadoDia {
  if (!contratoId) return 'sin_contrato';
  if (!evaluacion.esDiaLaborable) return 'no_laborable';

  const tieneEntrada = marcaciones.some(m => m.tipo === 'entrada');
  if (tieneEntrada) {
    return evaluacion.atraso?.esAtraso ? 'atraso' : 'presente';
  }
  return evaluacion.inasistencia.inasistencia ? 'ausente' : 'esperando';
}

function toJornadaVigente(t: TrabajadorDiaRow): JornadaPactadaVigente {
  return {
    trabajadorId: t.trabajador_id,
    tenantId: '',
    contratoId: t.contrato_id!,
    horasSemanalesPactadas: Number(t.horas_semanales_pactadas),
    permiteHorasExtras: t.permite_horas_extras ?? false,
    diaSemana: t.dia_semana!,
    horaInicio: t.hora_inicio!,
    horaTermino: t.hora_termino!,
    colacionInicio: t.colacion_inicio ?? null,
    colacionTermino: t.colacion_termino ?? null,
    toleranciaOverride: t.tolerancia_override !== null ? Number(t.tolerancia_override) : null,
  };
}

function toMarcacionEvaluable(m: MarcacionDiaRow): MarcacionEvaluable {
  return { id: m.id, tipo: m.tipo, timestampUtc: m.timestamp_utc, dentroGeocerca: m.dentro_geocerca };
}

@Injectable()
export class SupervisionService {
  constructor(
    private readonly repo: SupervisionRepository,
    private readonly jornadaService: JornadaService,
  ) {}

  async estadoDia(
    fechaOpt: string | undefined,
    dto: ListarDiaDto,
    db: PoolClient,
  ) {
    const ahora = new Date();
    const fechaStr = fechaOpt ?? fechaLocalChile(ahora);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaStr)) {
      throw new BadRequestException(`Formato de fecha inválido: ${fechaStr}`);
    }

    const limit = dto.limit ?? 50;
    const offset = dto.offset ?? 0;

    const fechaLocal = toLocalChile(new Date(`${fechaStr}T12:00:00Z`));
    const diaSemana = diaSemanaIso(fechaLocal);

    const [config, trabajadores, todasMarcaciones] = await Promise.all([
      this.repo.obtenerConfiguracion(db),
      this.repo.trabajadoresConJornadaDelDia(diaSemana, dto.centro_trabajo_id ?? null, db),
      this.repo.marcacionesDelDia(fechaStr, db),
    ]);

    // Group marcaciones by trabajador_id
    const marcPorTrab = new Map<string, MarcacionDiaRow[]>();
    for (const m of todasMarcaciones) {
      const list = marcPorTrab.get(m.trabajador_id) ?? [];
      list.push(m);
      marcPorTrab.set(m.trabajador_id, list);
    }

    const resultados = this.evaluarTodos(trabajadores, marcPorTrab, config, fechaStr, ahora);

    // Filter by estado (post-evaluation)
    const filtrados = dto.estado ? resultados.filter(r => r.estado_dia === dto.estado) : resultados;
    const paginados = filtrados.slice(offset, offset + limit);
    const resumen = this.calcularResumen(resultados);

    return {
      fecha: fechaStr,
      esDiaLaborable: config.diasLaborables.includes(diaSemana),
      data: paginados,
      total: filtrados.length,
      limit,
      offset,
      resumen,
    };
  }

  async alertas(dto: ListarAlertasDto, db: PoolClient) {
    const ahora = new Date();
    const desdeStr = dto.desde ?? fechaLocalChile(ahora);
    const hastaStr = dto.hasta ?? fechaLocalChile(ahora);

    if (desdeStr > hastaStr) {
      throw new BadRequestException('desde debe ser anterior o igual a hasta');
    }

    const diffMs = new Date(hastaStr).getTime() - new Date(desdeStr).getTime();
    const diffDias = diffMs / (1000 * 60 * 60 * 24);
    if (diffDias > 90) {
      throw new BadRequestException('El rango máximo entre desde y hasta es 90 días');
    }

    const tipos: TipoAlerta[] = dto.tipo ?? [
      'inasistencia_presunta',
      'fuera_geocerca',
      'atraso_recurrente',
      'colacion_no_marcada',
    ];

    const config = await this.repo.obtenerConfiguracion(db);

    const desdeUtc = `${desdeStr}T00:00:00-04:00`;
    const hastaUtc = `${hastaStr}T23:59:59-04:00`;

    const [
      inasistencias,
      geocercas,
      atrasos,
      colaciones,
    ] = await Promise.all([
      tipos.includes('inasistencia_presunta')
        ? this.repo.alertasInasistenciaPresunta(config.umbralInasistenciaSinMarcacionHoras, db)
        : Promise.resolve([]),
      tipos.includes('fuera_geocerca')
        ? this.repo.alertasFueraGeocerca(desdeUtc, hastaUtc, db)
        : Promise.resolve([]),
      tipos.includes('atraso_recurrente')
        ? this.repo.alertasAtrasoRecurrente(5, 3, db)
        : Promise.resolve([]),
      tipos.includes('colacion_no_marcada')
        ? this.repo.alertasColacionNoMarcada(db)
        : Promise.resolve([]),
    ]);

    const registradoEn = ahora.toISOString();

    const items = [
      ...inasistencias.map(r => ({
        tipo: 'inasistencia_presunta' as TipoAlerta,
        trabajador: this.trabResumen(r),
        fecha: fechaLocalChile(ahora),
        detalle: {
          jornada_pactada_inicio: r.hora_inicio,
          horas_desde_inicio_esperado: Math.round(Number(r.horas_desde_inicio) * 10) / 10,
          umbral_configurado_horas: Number(r.umbral_horas),
        },
        registrado_en: registradoEn,
      })),
      ...geocercas.map(r => ({
        tipo: 'fuera_geocerca' as TipoAlerta,
        trabajador: this.trabResumen(r),
        fecha: fechaLocalChile(r.timestamp_utc),
        detalle: {
          marcacion_id: r.marcacion_id,
          tipo_marcacion: r.tipo_marcacion,
          timestamp_utc: r.timestamp_utc.toISOString(),
          centro_asignado: r.centro_asignado ?? null,
          distancia_metros: r.distancia_metros ?? null,
        },
        registrado_en: r.timestamp_utc.toISOString(),
      })),
      ...atrasos.map(r => ({
        tipo: 'atraso_recurrente' as TipoAlerta,
        trabajador: this.trabResumen(r),
        fecha: null as string | null,
        detalle: {
          atrasos_ultimos_30_dias: Number(r.dias_con_atraso),
          minutos_promedio: r.promedio_minutos,
          ultima_fecha_atraso: r.ultima_fecha,
          umbral_minimo_atrasos: 3,
        },
        registrado_en: registradoEn,
      })),
      ...colaciones.map(r => ({
        tipo: 'colacion_no_marcada' as TipoAlerta,
        trabajador: this.trabResumen(r),
        fecha: fechaLocalChile(ahora),
        detalle: {
          colacion_pactada_inicio: r.colacion_inicio,
          minutos_pasados_desde_inicio_pactado: Math.round(Number(r.minutos_pasados)),
        },
        registrado_en: registradoEn,
      })),
    ];

    const limit = dto.limit ?? 50;
    const offset = dto.offset ?? 0;
    const paginados = items.slice(offset, offset + limit);

    const total_por_tipo = {
      inasistencia_presunta: inasistencias.length,
      fuera_geocerca: geocercas.length,
      atraso_recurrente: atrasos.length,
      colacion_no_marcada: colaciones.length,
    };

    return {
      data: paginados,
      total_por_tipo,
      total: items.length,
      limit,
      offset,
    };
  }

  async semanaTrabajador(
    trabajadorId: string,
    lunesStr: string,
    tenantId: string,
    db: PoolClient,
  ): Promise<ResultadoSemana> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(lunesStr)) {
      throw new BadRequestException(`Formato de fecha inválido: ${lunesStr}`);
    }

    const fechaLunes = toLocalChile(new Date(`${lunesStr}T12:00:00Z`));
    if (diaSemanaIso(fechaLunes) !== 1) {
      throw new BadRequestException('La fecha de inicio debe ser un lunes.');
    }

    const existe = await this.repo.existeTrabajador(trabajadorId, db);
    if (!existe) throw new NotFoundException('Trabajador no encontrado');

    return this.jornadaService.evaluarSemanaParaTrabajador(tenantId, trabajadorId, lunesStr, db);
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private evaluarTodos(
    trabajadores: TrabajadorDiaRow[],
    marcPorTrab: Map<string, MarcacionDiaRow[]>,
    config: ConfiguracionJornada,
    fechaStr: string,
    ahora: Date,
  ) {
    return trabajadores.map(t => {
      const rawMarcs = marcPorTrab.get(t.trabajador_id) ?? [];
      const marcaciones = rawMarcs.map(toMarcacionEvaluable);
      const jornada: JornadaPactadaVigente | null =
        t.contrato_id && t.dia_semana ? toJornadaVigente(t) : null;

      const evaluacion = evaluarJornadaDia(marcaciones, jornada, config, fechaStr, ahora);
      const estado_dia = derivarEstadoDia(t.contrato_id, evaluacion, marcaciones);

      const ultimaRaw = rawMarcs.length > 0 ? rawMarcs[rawMarcs.length - 1] : null;
      const ultima_marcacion = ultimaRaw
        ? {
            id: ultimaRaw.id,
            tipo: ultimaRaw.tipo,
            timestamp_utc: ultimaRaw.timestamp_utc.toISOString(),
            hora_local_chile: formatInTimeZone(ultimaRaw.timestamp_utc, 'America/Santiago', 'HH:mm:ss'),
            dentro_geocerca: ultimaRaw.dentro_geocerca,
          }
        : null;

      return {
        trabajador: {
          id: t.trabajador_id,
          rut: t.rut,
          nombres: t.nombres,
          apellido_paterno: t.apellido_paterno,
          apellido_materno: t.apellido_materno,
          centro_trabajo_id: t.centro_trabajo_id,
          centro_trabajo_nombre: t.centro_trabajo_nombre,
        },
        estado_dia,
        evaluacion: {
          atraso: evaluacion.atraso,
          inasistencia: evaluacion.inasistencia,
          colacion: evaluacion.colacion,
          horasTrabajadas: evaluacion.horasTrabajadas,
        },
        ultima_marcacion,
      };
    });
  }

  private calcularResumen(resultados: ReturnType<SupervisionService['evaluarTodos']>) {
    const resumen = {
      presentes: 0,
      atrasos: 0,
      ausentes: 0,
      esperando_marcacion: 0,
      no_laborable: 0,
      sin_contrato: 0,
      total_consultados: resultados.length,
    };
    for (const r of resultados) {
      if (r.estado_dia === 'presente') resumen.presentes++;
      else if (r.estado_dia === 'atraso') resumen.atrasos++;
      else if (r.estado_dia === 'ausente') resumen.ausentes++;
      else if (r.estado_dia === 'esperando') resumen.esperando_marcacion++;
      else if (r.estado_dia === 'no_laborable') resumen.no_laborable++;
      else if (r.estado_dia === 'sin_contrato') resumen.sin_contrato++;
    }
    return resumen;
  }

  private trabResumen(r: { trabajador_id: string; rut: string; nombres: string; apellido_paterno: string; centro_trabajo_id: string | null; centro_trabajo_nombre: string | null }) {
    return {
      id: r.trabajador_id,
      rut: r.rut,
      nombres: r.nombres,
      apellido_paterno: r.apellido_paterno,
      centro_trabajo_nombre: r.centro_trabajo_nombre,
    };
  }
}
