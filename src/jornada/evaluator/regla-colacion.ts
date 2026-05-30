import { ConfiguracionJornada, JornadaPactadaVigente, MarcacionEvaluable, ResultadoColacion } from '../types';

export function evaluarColacion(
  marcaciones: MarcacionEvaluable[],
  jornada: JornadaPactadaVigente,
  config: ConfiguracionJornada,
): ResultadoColacion {
  if (jornada.colacionInicio === null) {
    return { aplica: false, cumple: false, motivo: 'colacion_no_pactada' };
  }

  const inicios = marcaciones
    .filter(m => m.tipo === 'inicio_colacion')
    .sort((a, b) => a.timestampUtc.getTime() - b.timestampUtc.getTime());
  const fines = marcaciones
    .filter(m => m.tipo === 'fin_colacion')
    .sort((a, b) => a.timestampUtc.getTime() - b.timestampUtc.getTime());

  const inicioReal = inicios[0] ?? null;
  const finReal = fines[0] ?? null;

  if (inicioReal === null || finReal === null) {
    return { aplica: true, cumple: false, motivo: 'colacion_no_marcada_completa' };
  }

  const duracionReal = Math.round(
    (finReal.timestampUtc.getTime() - inicioReal.timestampUtc.getTime()) / 60_000,
  );

  if (duracionReal < 0) {
    return { aplica: true, cumple: false, motivo: 'datos_inconsistentes' };
  }

  const min = config.duracionMinimaColacionMinutos;
  const max = config.duracionMaximaColacionMinutos;

  if (duracionReal > max) {
    return {
      aplica: true,
      cumple: false,
      motivo: 'colacion_excedida',
      duracionRealMinutos: duracionReal,
      minimoMinutos: min,
      maximoMinutos: max,
      inicioReal: inicioReal.timestampUtc,
      finReal: finReal.timestampUtc,
    };
  }

  const cumple = duracionReal >= min && duracionReal <= max;
  return {
    aplica: true,
    cumple,
    motivo: cumple ? undefined : 'colacion_no_marcada_completa',
    duracionRealMinutos: duracionReal,
    minimoMinutos: min,
    maximoMinutos: max,
    inicioReal: inicioReal.timestampUtc,
    finReal: finReal.timestampUtc,
  };
}
