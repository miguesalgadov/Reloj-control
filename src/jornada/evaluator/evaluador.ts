import {
  ConfiguracionJornada,
  JornadaPactadaVigente,
  MarcacionEvaluable,
  ResultadoJornadaDia,
} from '../types';
import { evaluarAtraso } from './regla-atraso';
import { evaluarColacion } from './regla-colacion';
import { evaluarHorasTrabajadas } from './regla-horas-trabajadas';
import { evaluarInasistencia } from './regla-inasistencia';
import { evaluarSalidaAnticipada } from './regla-salida-anticipada';

export function evaluarJornadaDia(
  marcaciones: MarcacionEvaluable[],
  jornada: JornadaPactadaVigente | null,
  config: ConfiguracionJornada,
  fechaStr: string,
  ahora: Date,
): ResultadoJornadaDia {
  const anomalias: string[] = [];

  const entradas = marcaciones.filter(m => m.tipo === 'entrada');
  const salidas = marcaciones.filter(m => m.tipo === 'salida');
  if (entradas.length > 1 || salidas.length > 1) {
    anomalias.push('marcaciones_duplicadas');
  }

  const inasistencia = evaluarInasistencia(marcaciones, jornada, config, fechaStr, ahora);

  if (jornada === null) {
    return {
      fecha: fechaStr,
      esDiaLaborable: false,
      jornadaPactada: null,
      marcacionesDelDia: marcaciones,
      atraso: null,
      salidaAnticipada: null,
      inasistencia,
      colacion: { aplica: false, cumple: false, motivo: 'colacion_no_pactada' },
      horasTrabajadas: { horasTrabajadas: null, minutosTrabajados: null },
      anomalias,
    };
  }

  return {
    fecha: fechaStr,
    esDiaLaborable: true,
    jornadaPactada: jornada,
    marcacionesDelDia: marcaciones,
    atraso: evaluarAtraso(marcaciones, jornada, config),
    salidaAnticipada: evaluarSalidaAnticipada(marcaciones, jornada, config),
    inasistencia,
    colacion: evaluarColacion(marcaciones, jornada, config),
    horasTrabajadas: evaluarHorasTrabajadas(marcaciones, jornada, config),
    anomalias,
  };
}
