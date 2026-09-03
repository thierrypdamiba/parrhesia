import type { Metadata } from 'next';

import { PublicLetter } from '@/app/components/PublicLetter';

export const metadata: Metadata = { title: 'Public letter' };

export default async function PublicPage({
  params,
}: {
  params: Promise<{ public_token: string }>;
}) {
  const { public_token } = await params;
  return <PublicLetter publicToken={public_token} />;
}
