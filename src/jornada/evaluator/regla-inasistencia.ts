import { ConfiguracionJornada, JornadaPactadaVigente, MarcacionEvaluable, ResultadoInasistencia } from '../types';
import { fechaLocalChile, timeStrToMinutos, toLocalChile } from './utils';

export function evaluarInasistencia(
  marcaciones: MarcacionEvaluable[],
  jornada: JornadaPactadaVigente | null,
  config: ConfiguracionJornada,
  fechaStr: string, // 'YYYY-MM-DD' hora local Chile
  ahora: Date,      // momento de evaluación (UTC)
): ResultadoInasistencia {
  if (jornada === null) {
    return { inasistencia: false, motivo: 'no_laborable', presunta: false };
  }

  const tieneEntrada = marcaciones.some(m => m.tipo === 'entrada');
  if (tieneEntrada) {
    return { inasistencia: false, motivo: 'normal', presunta: false };
  }

  // Comparar contra la fecha LOCAL chilena de ahora (evita error en bordes de medianoche)
  const hoy = fechaLocalChile(ahora);

  if (fechaStr > hoy) {
    return { inasistencia: false, motivo: 'futuro', presunta: false };
  }

  if (fechaStr < hoy) {
    return { inasistencia: true, motivo: 'sin_marcacion_entrada', presunta: false };
  }

  // Es hoy: verificar si ya pasó el umbral desde la hora pactada de inicio
  const ahoraLocal = toLocalChile(ahora);
  const minutosAhora  = ahoraLocal.getHours() * 60 + ahoraLocal.getMinutes();
  const minutosInicio = timeStrToMinutos(jornada.horaInicio);
  const umbralMinutos = config.umbralInasistenciaSinMarcacionHoras * 60;

  if ((minutosAhora - minutosInicio) >= umbralMinutos) {
    return { inasistencia: true, motivo: 'inasistencia_presunta', presunta: true };
  }

  return { inasistencia: false, motivo: 'esperando_marcacion', presunta: false };
}
