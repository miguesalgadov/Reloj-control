import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { PaginadoMarcaciones } from '@/lib/types';

export function useMarcaciones(offset = 0, limit = 20) {
  return useQuery({
    queryKey: ['marcaciones', offset],
    queryFn: () =>
      api.get<PaginadoMarcaciones>(`/api/marcaciones/mias?limit=${limit}&offset=${offset}`),
  });
}
