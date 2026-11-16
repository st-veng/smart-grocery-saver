import type { ProductSummary } from '@sgs/shared';
import { useDeferredValue, useId, useState, type KeyboardEvent } from 'react';
import { useProductSearch } from '../lib/lists';

interface Props {
  /** Selected a catalog product. */
  readonly onPick: (p: ProductSummary) => void;
  /** Pressed Enter on free text (the server auto-matches it when confident). */
  readonly onFreeText: (text: string) => void;
  readonly disabled?: boolean;
}

/** WAI-ARIA combobox with a listbox popup: type to search the catalog, arrows + Enter to pick. */
export function ProductSearch({ onPick, onFreeText, disabled }: Props) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const deferred = useDeferredValue(text);
  const search = useProductSearch(deferred);
  const results = text.trim().length >= 2 ? (search.data ?? []) : [];
  const listId = useId();
  const inputId = useId();
  const expanded = open && results.length > 0;

  const reset = () => {
    setText('');
    setOpen(false);
    setActive(-1);
  };
  const pick = (p: ProductSummary) => {
    onPick(p);
    reset();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, -1));
    } else if (e.key === 'Escape') {
      setOpen(false);
      setActive(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const chosen = expanded && active >= 0 ? results[active] : undefined;
      if (chosen) pick(chosen);
      else if (text.trim()) {
        onFreeText(text.trim());
        reset();
      }
    }
  };

  return (
    <div className="relative">
      <label htmlFor={inputId} className="sr-only">
        Add item
      </label>
      <input
        id={inputId}
        role="combobox"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={expanded && active >= 0 ? `${listId}-${String(active)}` : undefined}
        autoComplete="off"
        placeholder="Add item — e.g. “2 lb ground beef”"
        disabled={disabled}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => {
          setOpen(false);
        }}
        className="block min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-base placeholder:text-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:placeholder:text-slate-400"
      />
      <ul
        id={listId}
        role="listbox"
        aria-label="Matching products"
        hidden={!expanded}
        className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
      >
        {results.map((p, i) => (
          <li
            key={p.id}
            id={`${listId}-${String(i)}`}
            role="option"
            aria-selected={i === active}
            onMouseDown={(e) => {
              e.preventDefault(); // keep focus in the input
              pick(p);
            }}
            className={`flex min-h-11 cursor-pointer items-center justify-between gap-2 px-3 ${i === active ? 'bg-brand-50 dark:bg-slate-800' : ''}`}
          >
            <span>{p.name}</span>
            <span className="text-xs text-slate-600 dark:text-slate-400">{p.categoryName}</span>
          </li>
        ))}
      </ul>
      <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
        Pick a match, or press Enter to add what you typed.
      </p>
    </div>
  );
}
