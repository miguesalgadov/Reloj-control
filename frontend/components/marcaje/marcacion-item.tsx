import { CheckCircle, XCircle } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import type { MarcacionMia, TipoMarcacion } from '@/lib/types';

const TIPO_LABEL: Record<TipoMarcacion, string> = {
  entrada: 'Entrada',
  salida: 'Salida',
  inicio_colacion: 'Inicio colación',
  fin_colacion: 'Fin colación',
  ajuste: 'Ajuste',
};

function horaChile(iso: string) {
  try {
    const d = parseISO(iso);
    return format(d, 'HH:mm', { locale: es });
  } catch {
    return iso;
  }
}

export function MarcacionItem({ marcacion }: { marcacion: MarcacionMia }) {
  const dentro = marcacion.dentro_geocerca !== false;

  return (
    <div className="flex items-center justify-between rounded-lg border border-slate-100 bg-white px-4 py-3">
      <div>
        <p className="text-sm font-medium text-slate-900">
          {TIPO_LABEL[marcacion.tipo]}
        </p>
        {marcacion.centro_trabajo_nombre && (
          <p className="text-xs text-slate-500">{marcacion.centro_trabajo_nombre}</p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <span
          className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
            dentro ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
          }`}
        >
          {dentro ? (
            <CheckCircle className="h-3 w-3" />
          ) : (
            <XCircle className="h-3 w-3" />
          )}
          {dentro ? 'En zona' : 'Fuera de zona'}
        </span>
        <span className="text-sm font-semibold text-slate-700 tabular-nums">
          {horaChile(marcacion.timestamp_utc)}
        </span>
      </div>
    </div>
  );
}
