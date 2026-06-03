import { CheckCircle, AlertCircle, Clock, XCircle } from 'lucide-react';
import type { ResultadoJornadaDia, TipoMarcacion } from '@/lib/types';

export type AccionMarcaje = TipoMarcacion | null;

interface EstadoInfo {
  label: string;
  color: string;
  icon: React.ReactNode;
  accion: AccionMarcaje;
  botonLabel: string;
  botonDisabled: boolean;
}

export function derivarAccion(jornada: ResultadoJornadaDia): EstadoInfo {
  const marcs = jornada.marcacionesDelDia;

  if (!jornada.esDiaLaborable || !jornada.jornadaPactada) {
    return {
      label: jornada.esDiaLaborable === false ? 'Día no laborable' : 'Sin contrato vigente',
      color: 'text-slate-500',
      icon: <XCircle className="h-5 w-5" />,
      accion: null,
      botonLabel: 'No disponible',
      botonDisabled: true,
    };
  }

  const tieneEntrada = marcs.some(m => m.tipo === 'entrada');
  const tieneInicioCol = marcs.some(m => m.tipo === 'inicio_colacion');
  const tieneFinCol = marcs.some(m => m.tipo === 'fin_colacion');
  const tieneSalida = marcs.some(m => m.tipo === 'salida');
  const tieneColacionPactada = !!jornada.jornadaPactada?.colacionInicio;

  if (tieneSalida) {
    return {
      label: 'Jornada completada',
      color: 'text-green-600',
      icon: <CheckCircle className="h-5 w-5" />,
      accion: null,
      botonLabel: 'Jornada completada',
      botonDisabled: true,
    };
  }

  if (!tieneEntrada) {
    return {
      label: 'Esperando entrada',
      color: 'text-amber-500',
      icon: <Clock className="h-5 w-5" />,
      accion: 'entrada',
      botonLabel: 'Marcar Entrada',
      botonDisabled: false,
    };
  }

  if (tieneColacionPactada && !tieneInicioCol) {
    return {
      label: 'Trabajando',
      color: 'text-blue-600',
      icon: <CheckCircle className="h-5 w-5" />,
      accion: 'inicio_colacion',
      botonLabel: 'Iniciar Colación',
      botonDisabled: false,
    };
  }

  if (tieneInicioCol && !tieneFinCol) {
    return {
      label: 'En colación',
      color: 'text-orange-500',
      icon: <Clock className="h-5 w-5" />,
      accion: 'fin_colacion',
      botonLabel: 'Volver de Colación',
      botonDisabled: false,
    };
  }

  return {
    label: 'Trabajando',
    color: 'text-blue-600',
    icon: <CheckCircle className="h-5 w-5" />,
    accion: 'salida',
    botonLabel: 'Marcar Salida',
    botonDisabled: false,
  };
}

export function EstadoActual({ jornada }: { jornada: ResultadoJornadaDia }) {
  const info = derivarAccion(jornada);

  return (
    <div className={`flex items-center gap-2 rounded-lg border bg-slate-50 px-4 py-3 text-sm font-medium ${info.color}`}>
      {info.icon}
      <span>Estado: {info.label}</span>
      {jornada.atraso?.esAtraso && (
        <span className="ml-auto rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-600">
          Atraso {jornada.atraso.minutosAtraso} min
        </span>
      )}
    </div>
  );
}
