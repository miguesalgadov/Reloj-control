export interface PerfilUsuario {
  id: string;
  email: string;
  nombres: string;
  apellidos: string;
  rol: 'admin_empresa' | 'supervisor' | 'trabajador';
  estado: string;
  trabajador_id: string | null;
}

export interface JornadaPactada {
  diaSemana: number;
  horaInicio: string;
  horaTermino: string;
  colacionInicio: string | null;
  colacionTermino: string | null;
  toleranciaMinutos: number;
}

export interface ResultadoAtraso {
  esAtraso: boolean;
  minutosAtraso: number;
  marcacionAnticipada: boolean;
}

export interface ResultadoInasistencia {
  inasistencia: boolean;
  motivo: string;
  presunta: boolean;
}

export interface ResultadoColacion {
  aplica: boolean;
  cumple: boolean;
  motivo?: string;
}

export interface ResultadoHorasTrabajadas {
  horasTrabajadas: number | null;
  minutosTrabajados: number | null;
}

export interface MarcacionEvaluable {
  id: string;
  tipo: TipoMarcacion;
  timestampUtc: string;
  dentroGeocerca: boolean | null;
}

export type TipoMarcacion = 'entrada' | 'salida' | 'inicio_colacion' | 'fin_colacion' | 'ajuste';

export interface ResultadoJornadaDia {
  fecha: string;
  esDiaLaborable: boolean;
  jornadaPactada: {
    horaInicio: string;
    horaTermino: string;
    colacionInicio: string | null;
    colacionTermino: string | null;
  } | null;
  marcacionesDelDia: MarcacionEvaluable[];
  atraso: ResultadoAtraso | null;
  salidaAnticipada: { esSalidaAnticipada: boolean; minutosSalidaAnticipada: number } | null;
  inasistencia: ResultadoInasistencia;
  colacion: ResultadoColacion;
  horasTrabajadas: ResultadoHorasTrabajadas;
  anomalias: string[];
}

export interface MarcacionMia {
  id: string;
  tipo: TipoMarcacion;
  timestamp_utc: string;
  dentro_geocerca: boolean | null;
  centro_trabajo_id: string | null;
  centro_trabajo_nombre: string | null;
  latitud: number | null;
  longitud: number | null;
}

export interface PaginadoMarcaciones {
  data: MarcacionMia[];
  total: number;
  limit: number;
  offset: number;
}

export interface LoginResponse {
  accessToken: string;
}
