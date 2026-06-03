'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { isAuthenticated } from '@/lib/auth';
import { Spinner } from '@/components/shared/spinner';

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  // Check synchronously during render — avoids setState-in-effect
  const authed = typeof window !== 'undefined' && isAuthenticated();

  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace('/login');
    }
  }, [router]);

  if (!authed) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  return <>{children}</>;
}
