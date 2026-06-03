import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { ResultadoJornadaDia } from '@/lib/types';

export function useJornadaHoy() {
  return useQuery({
    queryKey: ['jornada-hoy'],
    queryFn: () => api.get<ResultadoJornadaDia>('/api/jornadas/hoy'),
    refetchOnWindowFocus: true,
  });
}
