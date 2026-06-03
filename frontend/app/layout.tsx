import type { Metadata, Viewport } from 'next';
import { Toaster } from 'sonner';
import { QueryProvider } from '@/components/shared/query-provider';
import './globals.css';

export const metadata: Metadata = {
  title: 'Reloj Control',
  description: 'Sistema de control de asistencia',
  manifest: '/manifest.json',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Reloj Control' },
};

export const viewport: Viewport = {
  themeColor: '#4338ca',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <QueryProvider>
          <div className="mx-auto min-h-screen max-w-[500px] bg-white shadow-sm">
            {children}
          </div>
          <Toaster position="top-center" richColors />
        </QueryProvider>
      </body>
    </html>
  );
}
