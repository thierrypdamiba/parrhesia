'use client';

// Click-to-edit field (PLAN.md P4): text on display, a textarea on focus, PATCH on blur with the
// current rev. When the save fails with a stale revision the caller throws a message
// ('Updated by Maya; reapply your edit') that stays under the field with the draft intact.

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

import { cx } from '@/lib/client/format';

export interface EditableFieldProps {
  value: string;
  onSave: (text: string) => Promise<void>;
  ariaLabel: string;
  disabled?: boolean;
  placeholder?: string;
  /** Display class (e.g. 'quote' or 'serif'). */
  className?: string;
  rows?: number;
  minLength?: number;
  maxLength?: number;
}

export function EditableField({
  value,
  onSave,
  ariaLabel,
  disabled,
  placeholder,
  className,
  rows = 3,
  minLength = 0,
  maxLength = 600,
}: EditableFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [note, setNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);

  const begin = () => {
    if (disabled) return;
    setNote(null);
    setDraft(value);
    setEditing(true);
  };

  const commit = async () => {
    const text = draft.trim();
    if (text === value.trim()) {
      setEditing(false);
      setNote(null);
      return;
    }
    if (text.length < minLength) {
      setNote(
        `At least ${minLength} characters${text.length === 0 && minLength > 0 ? ' (or press Escape to cancel)' : ''}.`,
      );
      return;
    }
    if (text.length > maxLength) {
      setNote(`At most ${maxLength} characters.`);
      return;
    }
    setSaving(true);
    try {
      await onSave(text);
      setEditing(false);
      setNote(null);
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Could not save; try again.');
    } finally {
      setSaving(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setEditing(false);
      setNote(null);
      setDraft(value);
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void commit();
    }
  };

  if (editing) {
    return (
      <div>
        <textarea
          ref={ref}
          className={className}
          aria-label={ariaLabel}
          value={draft}
          rows={rows}
          maxLength={maxLength + 50}
          disabled={saving}
          onChange={e => setDraft(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={onKeyDown}
        />
        {note ? <div className="editable-note">{note}</div> : null}
        <div className="muted small">
          Esc cancels · Ctrl+Enter saves · saving happens when you leave the field
        </div>
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        className={cx('editable', className)}
        aria-label={disabled ? ariaLabel : `${ariaLabel} (click to edit)`}
        aria-disabled={disabled ? 'true' : undefined}
        onClick={begin}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            begin();
          }
        }}
      >
        {value ? (
          value
        ) : (
          <span className="placeholder">{placeholder ?? (disabled ? '—' : 'Click to write')}</span>
        )}
      </button>
      {note ? <div className="editable-note">{note}</div> : null}
    </div>
  );
}
