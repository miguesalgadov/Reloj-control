'use client';

import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useMarcar } from '@/lib/queries/use-marcar';
import { obtenerCoordenadas } from '@/lib/geolocation';
import { ApiError } from '@/lib/api';
import type { AccionMarcaje } from './estado-actual';

interface BotonMarcarProps {
  accion: AccionMarcaje;
  label: string;
  disabled: boolean;
  centroTrabajoId?: string | null;
}

export function BotonMarcar({ accion, label, disabled, centroTrabajoId }: BotonMarcarProps) {
  const { mutate, isPending } = useMarcar();

  const handleClick = async () => {
    if (!accion) return;

    let coords;
    try {
      coords = await obtenerCoordenadas();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error obteniendo ubicación.');
      return;
    }

    mutate(
      {
        tipo: accion,
        fuente: 'web',
        latitud: coords.latitud,
        longitud: coords.longitud,
        precisionMetros: coords.precisionMetros,
        ...(centroTrabajoId ? { centroTrabajoId } : {}),
      },
      {
        onSuccess: () => toast.success('Marcación registrada'),
        onError: (err) => {
          const msg = err instanceof ApiError ? err.message : 'Error al registrar marcación.';
          toast.error(msg);
        },
      },
    );
  };

  return (
    <Button
      size="lg"
      className="h-16 w-full text-base"
      onClick={handleClick}
      disabled={disabled || isPending}
    >
      {isPending && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
      {label}
    </Button>
  );
}
