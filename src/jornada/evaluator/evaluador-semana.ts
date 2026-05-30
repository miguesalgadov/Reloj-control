import {
  ConfiguracionJornada,
  JornadaPactadaVigente,
  MarcacionEvaluable,
  ResultadoJornadaDia,
  ResultadoSemana,
} from '../types';
import { evaluarJornadaDia } from './evaluador';
import { evaluarHorasExtra } from './regla-horas-extra';

export interface DatosDia {
  fechaStr: string;
  jornada: JornadaPactadaVigente | null;
  marcaciones: MarcacionEvaluable[];
}

export function evaluarSemana(
  diasData: DatosDia[],
  config: ConfiguracionJornada,
  ahora: Date,
  semanaInicio: string,
): ResultadoSemana {
  const dias: ResultadoJornadaDia[] = diasData.map(({ fechaStr, jornada, marcaciones }) =>
    evaluarJornadaDia(marcaciones, jornada, config, fechaStr, ahora),
  );

  const [y, mo, d] = semanaInicio.split('-').map(Number);
  const domingo = new Date(Date.UTC(y, mo - 1, d + 6));
  const semanaTermino = domingo.toISOString().slice(0, 10);

  let horasAcumuladas = 0;
  for (const dia of dias) {
    if (dia.horasTrabajadas.horasTrabajadas !== null) {
      horasAcumuladas += dia.horasTrabajadas.horasTrabajadas;
    }
  }
  horasAcumuladas = Math.round(horasAcumuladas * 100) / 100;

  const jornadaRef = diasData.find(({ jornada }) => jornada !== null)?.jornada ?? null;
  const horasPactadas = jornadaRef?.horasSemanalesPactadas ?? 0;
  const permiteHorasExtras = jornadaRef?.permiteHorasExtras ?? false;

  const diasMarcaciones = diasData.map(({ jornada, marcaciones }) => ({ jornada, marcaciones }));
  const resultadoExtra = evaluarHorasExtra(diasMarcaciones, config, permiteHorasExtras);

  const diferencia = Math.round((horasAcumuladas - horasPactadas) * 100) / 100;

  return {
    semanaInicio,
    semanaTermino,
    dias,
    horasAcumuladas,
    horasPactadas,
    diferencia,
    cumpleJornadaPactada: diferencia >= 0,
    horasExtra: resultadoExtra.horasExtra,
    minutosExtraBrutos: resultadoExtra.minutosExtraBrutos,
    minutosExtraRedondeados: resultadoExtra.minutosExtraRedondeados,
  };
}
