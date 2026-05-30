import { ConfiguracionJornada, JornadaPactadaVigente, MarcacionEvaluable, ResultadoHorasTrabajadas } from '../types';
import { timeStrToMinutos } from './utils';

export function evaluarHorasTrabajadas(
  marcaciones: MarcacionEvaluable[],
  jornada: JornadaPactadaVigente,
  config: ConfiguracionJornada,
): ResultadoHorasTrabajadas {
  const entradas = marcaciones
    .filter(m => m.tipo === 'entrada')
    .sort((a, b) => a.timestampUtc.getTime() - b.timestampUtc.getTime());
  const salidas = marcaciones
    .filter(m => m.tipo === 'salida')
    .sort((a, b) => a.timestampUtc.getTime() - b.timestampUtc.getTime());

  if (entradas.length === 0 || salidas.length === 0) {
    return { horasTrabajadas: null, minutosTrabajados: null, motivo: 'marcaje_incompleto' };
  }

  const entrada = entradas[0].timestampUtc;
  const salida = salidas[salidas.length - 1].timestampUtc;

  // Jornada que cruza medianoche: salida < entrada en UTC
  if (salida.getTime() <= entrada.getTime()) {
    return {
      horasTrabajadas: null,
      minutosTrabajados: null,
      motivo: 'jornada_cruza_medianoche_no_soportada',
    };
  }

  const duracionBruta = Math.round((salida.getTime() - entrada.getTime()) / 60_000);

  const tieneColacionPactada = jornada.colacionInicio !== null;
  const iniciosColacion = marcaciones
    .filter(m => m.tipo === 'inicio_colacion')
    .sort((a, b) => a.timestampUtc.getTime() - b.timestampUtc.getTime());
  const finesColacion = marcaciones
    .filter(m => m.tipo === 'fin_colacion')
    .sort((a, b) => a.timestampUtc.getTime() - b.timestampUtc.getTime());

  const colacionMarcadaCompleta =
    iniciosColacion.length > 0 && finesColacion.length > 0;

  let duracionNeta: number;

  if (tieneColacionPactada && colacionMarcadaCompleta) {
    const duracionColacion = Math.round(
      (finesColacion[0].timestampUtc.getTime() - iniciosColacion[0].timestampUtc.getTime()) / 60_000,
    );
    if (config.colacionEsImputableJornada) {
      duracionNeta = duracionBruta;
    } else {
      duracionNeta = duracionBruta - Math.max(0, duracionColacion);
    }
  } else if (tieneColacionPactada && !colacionMarcadaCompleta) {
    // Colación pactada pero no marcada → descontar la colación pactada
    const duracionColacionPactada =
      timeStrToMinutos(jornada.colacionTermino!) - timeStrToMinutos(jornada.colacionInicio!);
    duracionNeta = duracionBruta - Math.max(0, duracionColacionPactada);
  } else {
    duracionNeta = duracionBruta;
  }

  return {
    horasTrabajadas: Math.round((duracionNeta / 60) * 100) / 100,
    minutosTrabajados: duracionNeta,
  };
}
