import { ConfiguracionJornada, JornadaPactadaVigente, MarcacionEvaluable } from '../types';
import { timeStrToMinutos, utcToMinutosLocales } from './utils';

export interface ResultadoHorasExtra {
  horasExtra: number;
  minutosExtraBrutos: number;
  minutosExtraRedondeados: number;
  motivo?: string;
  redondeoAplicado: { bloque: number; modo: string };
}

function redondear(minutos: number, bloque: number, modo: 'abajo' | 'arriba' | 'cercano'): number {
  if (bloque <= 0) return minutos;
  switch (modo) {
    case 'abajo':  return Math.floor(minutos / bloque) * bloque;
    case 'arriba': return Math.ceil(minutos / bloque) * bloque;
    case 'cercano': return Math.round(minutos / bloque) * bloque;
  }
}

export function evaluarHorasExtra(
  diasMarcaciones: Array<{ jornada: JornadaPactadaVigente | null; marcaciones: MarcacionEvaluable[] }>,
  config: ConfiguracionJornada,
  permiteHorasExtras: boolean,
): ResultadoHorasExtra {
  const bloque = config.redondeoHorasExtraMinutos;
  // v1: fuerza 'abajo' independientemente de la configuración
  const modo: 'abajo' = 'abajo';

  let minutosExtraBrutos = 0;

  for (const { jornada, marcaciones } of diasMarcaciones) {
    if (jornada === null) continue;

    const salidas = marcaciones
      .filter(m => m.tipo === 'salida')
      .sort((a, b) => a.timestampUtc.getTime() - b.timestampUtc.getTime());

    if (salidas.length === 0) continue;

    const ultima = salidas[salidas.length - 1];
    const minutosSalida = utcToMinutosLocales(ultima.timestampUtc);
    const minutosTermino = timeStrToMinutos(jornada.horaTermino);
    const umbral = config.umbralJornadaExtendidaMinutos;

    const excedente = Math.max(0, minutosSalida - (minutosTermino + umbral));
    minutosExtraBrutos += excedente;
  }

  const minutosExtraRedondeados = redondear(minutosExtraBrutos, bloque, modo);
  const horasExtra = permiteHorasExtras ? minutosExtraRedondeados / 60 : 0;

  return {
    horasExtra,
    minutosExtraBrutos,
    minutosExtraRedondeados: permiteHorasExtras ? minutosExtraRedondeados : 0,
    motivo: permiteHorasExtras ? undefined : 'no_permitidas_por_contrato',
    redondeoAplicado: { bloque, modo },
  };
}
