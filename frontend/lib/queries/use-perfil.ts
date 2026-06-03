import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { PerfilUsuario } from '@/lib/types';

export function usePerfil() {
  return useQuery({
    queryKey: ['perfil'],
    queryFn: () => api.get<PerfilUsuario>('/api/usuarios/me'),
  });
}
