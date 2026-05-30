export interface JornadaPactadaVigente {
  trabajadorId: string;
  tenantId: string;
  contratoId: string;
  horasSemanalesPactadas: number;
  permiteHorasExtras: boolean;
  diaSemana: number;                 // 1..7 ISO
  horaInicio: string;                // 'HH:MM:SS'
  horaTermino: string;
  colacionInicio: string | null;
  colacionTermino: string | null;
  toleranciaOverride: number | null; // minutos, override de jornada
}

export interface MarcacionEvaluable {
  id: string;
  tipo: 'entrada' | 'salida' | 'inicio_colacion' | 'fin_colacion' | 'ajuste';
  timestampUtc: Date;
  dentroGeocerca: boolean | null;
}

export interface ConfiguracionJornada {
  toleranciaAtrasoMinutos: number;
  toleranciaSalidaAnticipadaMinutos: number;
  duracionMinimaColacionMinutos: number;
  duracionMaximaColacionMinutos: number;
  colacionEsImputableJornada: boolean;
  umbralInasistenciaSinMarcacionHoras: number;
  umbralJornadaExtendidaMinutos: number;
  redondeoHorasExtraMinutos: number;
  redondeoHorasExtraModo: 'abajo' | 'arriba' | 'cercano';
  diasLaborables: number[];
}

export interface ResultadoAtraso {
  esAtraso: boolean;
  minutosAtraso: number;
  marcacionAnticipada: boolean;
}

export interface ResultadoSalidaAnticipada {
  esSalidaAnticipada: boolean;
  minutosSalidaAnticipada: number;
}

export interface ResultadoInasistencia {
  inasistencia: boolean;
  motivo: 'no_laborable' | 'sin_marcacion_entrada' | 'inasistencia_presunta'
        | 'esperando_marcacion' | 'futuro' | 'normal';
  presunta: boolean;
}

export interface ResultadoColacion {
  aplica: boolean;
  cumple: boolean;
  motivo?: 'colacion_no_pactada' | 'colacion_no_marcada_completa'
         | 'colacion_excedida' | 'datos_inconsistentes';
  duracionRealMinutos?: number;
  minimoMinutos?: number;
  maximoMinutos?: number;
  inicioReal?: Date;
  finReal?: Date;
}

export interface ResultadoHorasTrabajadas {
  horasTrabajadas: number | null;
  minutosTrabajados: number | null;
  motivo?: 'marcaje_incompleto' | 'jornada_cruza_medianoche_no_soportada';
}

export interface ResultadoJornadaDia {
  fecha: string;                      // 'YYYY-MM-DD' hora local Chile
  esDiaLaborable: boolean;
  jornadaPactada: JornadaPactadaVigente | null;
  marcacionesDelDia: MarcacionEvaluable[];
  atraso: ResultadoAtraso | null;
  salidaAnticipada: ResultadoSalidaAnticipada | null;
  inasistencia: ResultadoInasistencia;
  colacion: ResultadoColacion;
  horasTrabajadas: ResultadoHorasTrabajadas;
  anomalias: string[];                // 'marcaciones_duplicadas', etc.
}

export interface ResultadoSemana {
  semanaInicio: string;               // lunes 'YYYY-MM-DD'
  semanaTermino: string;              // domingo 'YYYY-MM-DD'
  dias: ResultadoJornadaDia[];
  horasAcumuladas: number;
  horasPactadas: number;
  diferencia: number;
  cumpleJornadaPactada: boolean;
  horasExtra: number;
  minutosExtraBrutos: number;
  minutosExtraRedondeados: number;
}
