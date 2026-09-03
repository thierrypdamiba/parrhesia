// Word-level inline diff for proposal cards (PLAN.md 2.2 item 4: red strike / green insert).
// Same LCS as server/letter.ts wordDiff, but positioned so it renders over the field.

export interface DiffToken {
  kind: 'same' | 'removed' | 'added';
  text: string;
}

export function inlineDiff(before: string, after: string): DiffToken[] {
  const a = before.split(/\s+/).filter(Boolean);
  const b = after.split(/\s+/).filter(Boolean);
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffToken[] = [];
  const push = (kind: DiffToken['kind'], word: string) => {
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += ` ${word}`;
    else out.push({ kind, text: word });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push('same', a[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push('removed', a[i++]);
    } else {
      push('added', b[j++]);
    }
  }
  while (i < n) push('removed', a[i++]);
  while (j < m) push('added', b[j++]);
  return out;
}
