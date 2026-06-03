'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, List } from 'lucide-react';
import { cn } from '@/lib/utils';

const LINKS = [
  { href: '/', label: 'Inicio', Icon: Home },
  { href: '/marcaciones', label: 'Mis marcaciones', Icon: List },
];

export function NavBottom() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-1/2 w-full max-w-[500px] -translate-x-1/2 border-t border-slate-100 bg-white">
      <ul className="flex">
        {LINKS.map(({ href, label, Icon }) => {
          const active = pathname === href;
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                className={cn(
                  'flex flex-col items-center gap-1 py-3 text-xs font-medium transition-colors',
                  active ? 'text-indigo-600' : 'text-slate-500 hover:text-slate-900',
                )}
              >
                <Icon className={cn('h-5 w-5', active && 'text-indigo-600')} />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
