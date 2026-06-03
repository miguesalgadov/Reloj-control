'use client';

import { useState } from 'react';
import { format, parseISO, isToday, isYesterday } from 'date-fns';
import { es } from 'date-fns/locale';
import { AuthGuard } from '@/components/auth/auth-guard';
import { Header } from '@/components/shared/header';
import { Spinner } from '@/components/shared/spinner';
import { MarcacionItem } from '@/components/marcaje/marcacion-item';
import { Button } from '@/components/ui/button';
import { NavBottom } from '@/components/shared/nav-bottom';
import { useMarcaciones } from '@/lib/queries/use-marcaciones';
import type { MarcacionMia } from '@/lib/types';

const LIMIT = 20;

function etiquetaDia(iso: string): string {
  try {
    const d = parseISO(iso);
    if (isToday(d)) return 'Hoy';
    if (isYesterday(d)) return 'Ayer';
    return format(d, "EEEE d 'de' MMMM", { locale: es });
  } catch {
    return iso.slice(0, 10);
  }
}

function agruparPorDia(marcaciones: MarcacionMia[]): Map<string, MarcacionMia[]> {
  const map = new Map<string, MarcacionMia[]>();
  for (const m of marcaciones) {
    const clave = m.timestamp_utc.slice(0, 10);
    const lista = map.get(clave) ?? [];
    lista.push(m);
    map.set(clave, lista);
  }
  return map;
}

export default function MarcacionesPage() {
  return (
    <AuthGuard>
      <Contenido />
    </AuthGuard>
  );
}

function Contenido() {
  const [offset, setOffset] = useState(0);
  const [acumuladas, setAcumuladas] = useState<MarcacionMia[]>([]);
  const { data, isLoading, isFetching } = useMarcaciones(offset, LIMIT);

  if (data && data.data.length > 0) {
    const nuevas = data.data.filter(m => !acumuladas.find(a => a.id === m.id));
    if (nuevas.length > 0) setAcumuladas(prev => [...prev, ...nuevas]);
  }

  const grupos = agruparPorDia(acumuladas);
  const diasOrdenados = [...grupos.keys()].sort((a, b) => b.localeCompare(a));
  const hayMas = data ? offset + LIMIT < data.total : false;

  return (
    <div className="flex min-h-screen flex-col">
      <Header titulo="Mis Marcaciones" />

      <NavBottom />
      <main className="flex-1 space-y-4 p-4 pb-24">
        {isLoading && acumuladas.length === 0 && (
          <div className="flex items-center justify-center py-12">
            <Spinner className="h-8 w-8" />
          </div>
        )}

        {!isLoading && acumuladas.length === 0 && (
          <p className="py-12 text-center text-sm text-slate-500">
            No tienes marcaciones registradas.
          </p>
        )}

        {diasOrdenados.map(dia => (
          <div key={dia} className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              {etiquetaDia(`${dia}T12:00:00Z`)}
            </p>
            {(grupos.get(dia) ?? [])
              .sort((a, b) => b.timestamp_utc.localeCompare(a.timestamp_utc))
              .map(m => (
                <MarcacionItem key={m.id} marcacion={m} />
              ))}
          </div>
        ))}

        {hayMas && (
          <Button
            variant="outline"
            className="w-full"
            onClick={() => setOffset(o => o + LIMIT)}
            disabled={isFetching}
          >
            {isFetching ? <Spinner className="mr-2" /> : null}
            Cargar más antiguas
          </Button>
        )}
      </main>
    </div>
  );
}
