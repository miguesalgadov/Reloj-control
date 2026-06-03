'use client';

import { LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { logout } from '@/lib/auth';

interface HeaderProps {
  titulo: string;
  nombre?: string;
}

export function Header({ titulo, nombre }: HeaderProps) {
  return (
    <header className="flex items-center justify-between border-b border-slate-100 bg-white px-4 py-3">
      <div>
        <span className="font-semibold text-slate-900">
          {nombre ? `Hola, ${nombre}` : titulo}
        </span>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={logout}
        className="gap-1.5 text-slate-500 hover:text-slate-900"
      >
        <LogOut className="h-4 w-4" />
        Salir
      </Button>
    </header>
  );
}
