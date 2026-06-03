import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { TipoMarcacion } from '@/lib/types';

interface CrearMarcacionDto {
  tipo: TipoMarcacion;
  fuente: 'web';
  latitud: number;
  longitud: number;
  precisionMetros: number;
  centroTrabajoId?: string;
}

export function useMarcar() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (dto: CrearMarcacionDto) =>
      api.post('/api/marcaciones', dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['jornada-hoy'] });
      qc.invalidateQueries({ queryKey: ['marcaciones'] });
    },
  });
}
