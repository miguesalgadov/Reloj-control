import { api } from './api';
import type { LoginResponse } from './types';

const TOKEN_KEY = 'rc_token';

export async function login(email: string, password: string): Promise<void> {
  const res = await api.post<LoginResponse>('/api/auth/login', { email, password }, { auth: false });
  if (typeof window !== 'undefined') {
    localStorage.setItem(TOKEN_KEY, res.accessToken);
  }
}

export function logout(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(TOKEN_KEY);
    window.location.href = '/login';
  }
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function isAuthenticated(): boolean {
  return getToken() !== null;
}
