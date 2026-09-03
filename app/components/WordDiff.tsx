import { inlineDiff } from '@/lib/client/diff';

/** Word-level diff rendered as text nodes (red strike / green insert). */
export function WordDiff({
  before,
  after,
  className,
}: {
  before: string;
  after: string;
  className?: string;
}) {
  const tokens = inlineDiff(before, after);
  return (
    <span className={className}>
      {tokens.map((t, i) => {
        const sep = i > 0 ? ' ' : '';
        if (t.kind === 'same') return <span key={i}>{sep + t.text}</span>;
        return (
          <span key={i}>
            {sep}
            {t.kind === 'removed' ? (
              <del className="diff-removed">{t.text}</del>
            ) : (
              <ins className="diff-added" style={{ textDecoration: 'none' }}>
                {t.text}
              </ins>
            )}
          </span>
        );
      })}
    </span>
  );
}
