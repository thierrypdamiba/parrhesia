import type { Metadata } from 'next';

import { Workspace } from '@/app/components/Workspace';

export const metadata: Metadata = { title: 'Letter' };

export default async function LetterPage({
  params,
  searchParams,
}: {
  params: Promise<{ share_code: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { share_code } = await params;
  const sp = await searchParams;
  const judge = sp.judge === '1';
  return <Workspace shareCode={share_code} judge={judge} />;
}
