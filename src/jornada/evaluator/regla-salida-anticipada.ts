import { ConfiguracionJornada, JornadaPactadaVigente, MarcacionEvaluable, ResultadoSalidaAnticipada } from '../types';
import { timeStrToMinutos, utcToMinutosLocales } from './utils';

export function evaluarSalidaAnticipada(
  marcaciones: MarcacionEvaluable[],
  jornada: JornadaPactadaVigente,
  config: ConfiguracionJornada,
): ResultadoSalidaAnticipada {
  const salidas = marcaciones
    .filter(m => m.tipo === 'salida')
    .sort((a, b) => a.timestampUtc.getTime() - b.timestampUtc.getTime());

  // Sin marcación de salida: no aplica (ver Regla 5)
  if (salidas.length === 0) {
    return { esSalidaAnticipada: false, minutosSalidaAnticipada: 0 };
  }

  // Se usa la última salida del día
  const ultima = salidas[salidas.length - 1];
  const minutosSalida = utcToMinutosLocales(ultima.timestampUtc);
  const minutosTermino = timeStrToMinutos(jornada.horaTermino);

  const tolerancia = config.toleranciaSalidaAnticipadaMinutos;
  const limite = minutosTermino - tolerancia;
  const esSalidaAnticipada = minutosSalida < limite;
  const minutosSalidaAnticipada = Math.max(0, minutosTermino - minutosSalida);

  return { esSalidaAnticipada, minutosSalidaAnticipada };
}
