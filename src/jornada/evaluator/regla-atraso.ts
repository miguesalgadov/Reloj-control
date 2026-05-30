import { ConfiguracionJornada, JornadaPactadaVigente, MarcacionEvaluable, ResultadoAtraso } from '../types';
import { timeStrToMinutos, utcToMinutosLocales } from './utils';

export function evaluarAtraso(
  marcaciones: MarcacionEvaluable[],
  jornada: JornadaPactadaVigente,
  config: ConfiguracionJornada,
): ResultadoAtraso {
  const entradas = marcaciones
    .filter(m => m.tipo === 'entrada')
    .sort((a, b) => a.timestampUtc.getTime() - b.timestampUtc.getTime());

  // Sin marcación de entrada: la regla no aplica (aplica Regla 3)
  if (entradas.length === 0) {
    return { esAtraso: false, minutosAtraso: 0, marcacionAnticipada: false };
  }

  const primera = entradas[0];
  const minutosEntrada = utcToMinutosLocales(primera.timestampUtc);
  const minutosInicio = timeStrToMinutos(jornada.horaInicio);

  const tolerancia = jornada.toleranciaOverride ?? config.toleranciaAtrasoMinutos;
  const limite = minutosInicio + tolerancia;
  const esAtraso = minutosEntrada > limite;
  const minutosAtraso = Math.max(0, minutosEntrada - minutosInicio);
  const marcacionAnticipada = minutosEntrada < minutosInicio;

  return { esAtraso, minutosAtraso, marcacionAnticipada };
}
