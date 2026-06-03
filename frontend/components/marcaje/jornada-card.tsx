import { Clock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ResultadoJornadaDia } from '@/lib/types';

function horaCorta(h: string | null | undefined) {
  if (!h) return null;
  return h.slice(0, 5);
}

export function JornadaCard({ jornada }: { jornada: ResultadoJornadaDia }) {
  const jp = jornada.jornadaPactada;

  if (!jornada.esDiaLaborable || !jp) {
    return (
      <Card>
        <CardContent className="py-4 text-center text-sm text-slate-500">
          {!jornada.esDiaLaborable ? 'Hoy no tienes jornada programada.' : 'Sin contrato vigente.'}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <Clock className="h-4 w-4 text-indigo-500" />
          Tu jornada hoy
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-slate-500">Entrada</span>
          <span className="font-medium">{horaCorta(jp.horaInicio)}</span>
        </div>
        {jp.colacionInicio && (
          <div className="flex justify-between">
            <span className="text-slate-500">Colación</span>
            <span className="font-medium">
              {horaCorta(jp.colacionInicio)}–{horaCorta(jp.colacionTermino)}
            </span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-slate-500">Salida</span>
          <span className="font-medium">{horaCorta(jp.horaTermino)}</span>
        </div>
      </CardContent>
    </Card>
  );
}
