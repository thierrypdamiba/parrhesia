// Tiny toast store: pages push lines that name the actor (PLAN.md 2.6 "toasts name the actor");
// app/components/Toasts.tsx renders them.

export interface Toast {
  id: number;
  who?: string;
  text: string;
  tone: 'info' | 'error';
}

type Listener = (toasts: readonly Toast[]) => void;

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<Listener>();

function emit(): void {
  for (const l of listeners) l(toasts);
}

export function pushToast(
  text: string,
  opts: { who?: string; tone?: Toast['tone']; ttl?: number } = {},
): void {
  const toast: Toast = { id: nextId++, text, who: opts.who, tone: opts.tone ?? 'info' };
  toasts = [...toasts.slice(-3), toast];
  emit();
  if (typeof window !== 'undefined') {
    window.setTimeout(
      () => dismissToast(toast.id),
      opts.ttl ?? (opts.tone === 'error' ? 8000 : 5000),
    );
  }
}

export function dismissToast(id: number): void {
  if (!toasts.some(t => t.id === id)) return;
  toasts = toasts.filter(t => t.id !== id);
  emit();
}

export function subscribeToasts(listener: Listener | (() => void)): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getToasts(): readonly Toast[] {
  return toasts;
}
