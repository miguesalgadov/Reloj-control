'use client';

import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { AuthGuard } from '@/components/auth/auth-guard';
import { Header } from '@/components/shared/header';
import { Spinner } from '@/components/shared/spinner';
import { JornadaCard } from '@/components/marcaje/jornada-card';
import { EstadoActual, derivarAccion } from '@/components/marcaje/estado-actual';
import { BotonMarcar } from '@/components/marcaje/boton-marcar';
import { NavBottom } from '@/components/shared/nav-bottom';
import { usePerfil } from '@/lib/queries/use-perfil';
import { useJornadaHoy } from '@/lib/queries/use-jornada-hoy';

export default function InicioDiaPage() {
  return (
    <AuthGuard>
      <Contenido />
    </AuthGuard>
  );
}

function Contenido() {
  const { data: perfil } = usePerfil();
  const { data: jornada, isLoading, error } = useJornadaHoy();

  const hoy = format(new Date(), "EEEE d 'de' MMMM", { locale: es });
  const nombre = perfil
    ? `${perfil.nombres} ${perfil.apellidos}`.trim()
    : undefined;

  return (
    <div className="flex min-h-screen flex-col">
      <Header titulo="Inicio" nombre={nombre} />

      <NavBottom />
      <main className="flex flex-1 flex-col gap-4 p-4 pb-24">
        <p className="text-sm font-medium capitalize text-slate-500">{hoy}</p>

        {isLoading && (
          <div className="flex flex-1 items-center justify-center">
            <Spinner className="h-8 w-8" />
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-600">
            No se pudo cargar la información de la jornada.
          </div>
        )}

        {jornada && (
          <>
            <JornadaCard jornada={jornada} />
            <EstadoActual jornada={jornada} />

            <div className="mt-auto pt-4">
              {(() => {
                const info = derivarAccion(jornada);
                return (
                  <BotonMarcar
                    accion={info.accion}
                    label={info.botonLabel}
                    disabled={info.botonDisabled}
                    centroTrabajoId={jornada.jornadaPactada ? undefined : undefined}
                  />
                );
              })()}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
