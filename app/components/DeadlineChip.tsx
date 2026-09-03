import { cx, deadline } from '@/lib/client/format';

export function DeadlineChip({
  comments_close_on,
  days_left,
}: {
  comments_close_on: string | null | undefined;
  days_left: number | null | undefined;
}) {
  const d = deadline(comments_close_on, days_left);
  if (!d.text) return null;
  return (
    <span
      className={cx(
        'deadline',
        d.tone === 'amber' && 'deadline-amber',
        d.tone === 'red' && 'deadline-red',
      )}
      title="the window when anyone can respond (the comment period)"
    >
      {d.text}
    </span>
  );
}
