import { Suspense } from 'react';

import { Home } from '@/app/components/Home';

export default function HomePage() {
  return (
    <Suspense fallback={<main className="page muted">Loading…</main>}>
      <Home />
    </Suspense>
  );
}
