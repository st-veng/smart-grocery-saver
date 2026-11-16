import type { ImportPreviewLine, ImportPreviewResponse } from '@sgs/shared';
import { useId, useState, type SyntheticEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { card, Field, FormError, primaryButton, secondaryButton } from '../components/ui';
import { ApiError } from '../lib/api';
import { formatNumber, UNIT_LABEL } from '../lib/format';
import { useImportCommit, useImportPreview, useList } from '../lib/lists';

const message = (e: unknown) =>
  e instanceof ApiError ? e.message : e ? 'Something went wrong' : null;
const MAX_BYTES = 1_000_000;

/** Per-line choice: a product id, "text" (keep unpriced), or "skip". */
type Choice = string;

const STATUS: Record<ImportPreviewLine['status'], { label: string; icon: string; cls: string }> = {
  matched: {
    label: 'Matched',
    icon: '✓',
    cls: 'bg-brand-50 text-brand-800 dark:bg-slate-800 dark:text-brand-100',
  },
  ambiguous: {
    label: 'Pick one',
    icon: '?',
    cls: 'bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100',
  },
  unmatched: {
    label: 'No match',
    icon: '✕',
    cls: 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200',
  },
};

function LineRow({
  line,
  choice,
  onChoose,
}: {
  line: ImportPreviewLine;
  choice: Choice;
  onChoose: (c: Choice) => void;
}) {
  const id = useId();
  const s = STATUS[line.status];
  const qty = `${formatNumber(line.quantity)}${line.unit ? ` ${UNIT_LABEL[line.unit]}` : ''}`;
  return (
    <li className="space-y-2 py-3">
      <div className="flex items-start justify-between gap-2">
        <span>
          <span className="font-medium">{line.raw}</span>
          <span className="block text-sm text-slate-600 dark:text-slate-400">
            Line {line.lineNo} · {qty}
          </span>
        </span>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}>
          <span aria-hidden="true">{s.icon} </span>
          {s.label}
        </span>
      </div>
      <label htmlFor={id} className="sr-only">
        Product for “{line.raw}”
      </label>
      <select
        id={id}
        value={choice}
        onChange={(e) => {
          onChoose(e.target.value);
        }}
        className="block min-h-11 w-full rounded-xl border border-slate-300 bg-white px-2 dark:border-slate-700 dark:bg-slate-900"
      >
        {line.candidates.map((c) => (
          <option key={c.productId} value={c.productId}>
            {c.name}
          </option>
        ))}
        <option value="text">Keep as text (not priced)</option>
        <option value="skip">Skip this line</option>
      </select>
    </li>
  );
}

function initialChoices(p: ImportPreviewResponse): Choice[] {
  // Only confident matches are pre-selected; ambiguous lines default to plain text until the user picks.
  return p.lines.map((l) => (l.status === 'matched' && l.productId ? l.productId : 'text'));
}

export function ImportPage() {
  const { id } = useParams();
  const target = useList(id ?? '', id !== undefined);
  const navigate = useNavigate();
  const preview = useImportPreview();
  const commit = useImportCommit();
  const [format, setFormat] = useState<'text' | 'csv'>('text');
  const [text, setText] = useState('');
  const [csv, setCsv] = useState<{ name: string; content: string } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [newName, setNewName] = useState('Imported list');
  const [choices, setChoices] = useState<Choice[]>([]);
  const textId = useId();
  const fileId = useId();

  const runPreview = (e: SyntheticEvent) => {
    e.preventDefault();
    const content = format === 'text' ? text : (csv?.content ?? '');
    if (!content.trim()) {
      setFileError(format === 'text' ? 'Paste at least one item' : 'Choose a CSV file');
      return;
    }
    setFileError(null);
    preview.mutate(
      { format, content },
      {
        onSuccess: (p) => {
          setChoices(initialChoices(p));
        },
      },
    );
  };

  const onFile = (file: File | undefined) => {
    setCsv(null);
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setFileError('That file is over 1 MB.');
      return;
    }
    setFileError(null);
    void file.text().then((content) => {
      setCsv({ name: file.name, content });
    });
  };

  const result = preview.data;
  const toAdd = result
    ? result.lines.flatMap((l, i) => {
        const c = choices[i] ?? 'text';
        if (c === 'skip') return [];
        return [
          {
            raw: l.raw,
            productId: c === 'text' ? null : c,
            quantity: l.quantity,
            unit: c === 'text' ? null : l.unit,
            brand: l.brand,
            notes: l.notes,
          },
        ];
      })
    : [];

  const doCommit = () => {
    commit.mutate(
      id
        ? { listId: id, lines: toAdd }
        : { newListName: newName.trim() || 'Imported list', lines: toAdd },
      { onSuccess: (l) => void navigate(`/lists/${l.id}`) },
    );
  };

  return (
    <section aria-labelledby="imp-h" className="space-y-4">
      <p>
        <Link
          to={id ? `/lists/${id}` : '/'}
          className="text-sm font-medium text-brand-700 underline dark:text-brand-100"
        >
          ← {id ? (target.data?.name ?? 'Back to list') : 'My Lists'}
        </Link>
      </p>
      <h1 id="imp-h" className="text-2xl font-bold tracking-tight">
        Import items
      </h1>
      <form onSubmit={runPreview} noValidate className={`${card} space-y-4`}>
        <fieldset className="flex gap-4">
          <legend className="sr-only">Import from</legend>
          {(['text', 'csv'] as const).map((f) => (
            <label key={f} className="flex min-h-11 items-center gap-2">
              <input
                type="radio"
                name="format"
                value={f}
                checked={format === f}
                onChange={() => {
                  setFormat(f);
                }}
                className="size-5 accent-brand-700"
              />
              {f === 'text' ? 'Paste text' : 'CSV file'}
            </label>
          ))}
        </fieldset>
        {format === 'text' ? (
          <div className="space-y-1">
            <label htmlFor={textId} className="block text-sm font-medium">
              Your list, one item per line
            </label>
            <textarea
              id={textId}
              rows={8}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
              }}
              placeholder={'2 lb ground beef\nmilk x2\n1/2 gal oj\ndozen eggs'}
              className="block w-full rounded-xl border border-slate-300 bg-white p-3 text-base dark:border-slate-700 dark:bg-slate-950"
            />
          </div>
        ) : (
          <div className="space-y-1">
            <label htmlFor={fileId} className="block text-sm font-medium">
              CSV file (needs an “item” column; quantity, unit, brand and notes are optional)
            </label>
            <input
              id={fileId}
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                onFile(e.target.files?.[0]);
              }}
              className="block w-full text-sm"
            />
            {csv ? <p className="text-sm text-slate-600 dark:text-slate-400">{csv.name}</p> : null}
          </div>
        )}
        <FormError message={fileError ?? message(preview.error)} />
        <button type="submit" className={primaryButton} disabled={preview.isPending}>
          {preview.isPending ? 'Reading…' : 'Preview'}
        </button>
      </form>

      {result ? (
        <div className={`${card} space-y-4`}>
          <h2 className="text-lg font-semibold">Review</h2>
          <p className="text-sm text-slate-700 dark:text-slate-300">
            {result.lines.filter((l) => l.status === 'matched').length} of {result.lines.length}{' '}
            matched. Lines marked “Pick one” stay as text unless you choose a product.
          </p>
          {result.errors.length > 0 ? (
            <ul
              className="space-y-1 rounded-xl bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200"
              aria-label="Lines we could not read"
            >
              {result.errors.map((e) => (
                <li key={e.lineNo}>
                  Line {e.lineNo}: {e.message}
                </li>
              ))}
            </ul>
          ) : null}
          <ul className="divide-y divide-slate-200 dark:divide-slate-800">
            {result.lines.map((l, i) => (
              <LineRow
                key={`${String(l.lineNo)}-${l.raw}`}
                line={l}
                choice={choices[i] ?? 'text'}
                onChoose={(c) => {
                  setChoices((cs) => cs.map((x, k) => (k === i ? c : x)));
                }}
              />
            ))}
          </ul>
          {!id ? (
            <Field
              label="New list name"
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value);
              }}
            />
          ) : null}
          <FormError message={message(commit.error)} />
          <button
            type="button"
            className={primaryButton}
            disabled={commit.isPending || toAdd.length === 0}
            onClick={doCommit}
          >
            {commit.isPending
              ? 'Adding…'
              : `Add ${String(toAdd.length)} item${toAdd.length === 1 ? '' : 's'}`}
          </button>
          <button
            type="button"
            className={`${secondaryButton} w-full`}
            onClick={() => {
              preview.reset();
            }}
          >
            Start over
          </button>
        </div>
      ) : null}
    </section>
  );
}
