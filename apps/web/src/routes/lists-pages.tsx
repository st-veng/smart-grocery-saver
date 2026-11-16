import type { ListSummary } from '@sgs/shared';
import { useState, type SyntheticEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { HealthStatus } from '../components/HealthStatus';
import { card, Field, FormError, primaryButton, secondaryButton, Spinner } from '../components/ui';
import { ApiError } from '../lib/api';
import { useMe } from '../lib/auth';
import { useCreateList, useLists, useTemplate, useTemplates } from '../lib/lists';
import { formatQuantity } from '../lib/format';

const message = (e: unknown) =>
  e instanceof ApiError ? e.message : e ? 'Something went wrong' : null;

function ListCard({ list }: { list: ListSummary }) {
  return (
    <li>
      <Link
        to={`/lists/${list.id}`}
        className={`${card} block hover:border-brand-600 focus-visible:border-brand-600 dark:hover:border-brand-600`}
      >
        <span className="block font-semibold">{list.name}</span>
        <span className="block text-sm text-slate-600 dark:text-slate-400">
          {list.itemCount} item{list.itemCount === 1 ? '' : 's'}
          {list.checkedCount > 0 ? ` · ${String(list.checkedCount)} checked` : ''}
        </span>
      </Link>
    </li>
  );
}

function NewListForm() {
  const create = useCreateList();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | undefined>();
  const submit = (e: SyntheticEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Give the list a name');
      return;
    }
    setError(undefined);
    create.mutate({ name: name.trim() }, { onSuccess: (l) => void navigate(`/lists/${l.id}`) });
  };
  return (
    <form onSubmit={submit} noValidate className="flex items-end gap-2">
      <div className="flex-1">
        <Field
          label="New list"
          placeholder="e.g. This week"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
          }}
          error={error ?? message(create.error) ?? undefined}
        />
      </div>
      <button type="submit" className={`${primaryButton} w-auto`} disabled={create.isPending}>
        Create
      </button>
    </form>
  );
}

export function ListsPage() {
  const me = useMe();
  const lists = useLists();
  return (
    <section aria-labelledby="lists-h" className="space-y-4">
      <div>
        <h1 id="lists-h" className="text-2xl font-bold tracking-tight">
          My Lists
        </h1>
        {me.data ? (
          <p className="text-slate-700 dark:text-slate-300">Hi, {me.data.displayName}!</p>
        ) : null}
      </div>
      <div className={card}>
        <NewListForm />
        <div className="mt-3 flex flex-wrap gap-2">
          <Link to="/templates" className={secondaryButton}>
            Start from a template
          </Link>
          <Link to="/import" className={secondaryButton}>
            Import a list
          </Link>
        </div>
      </div>
      {lists.isPending ? (
        <Spinner label="Loading lists…" />
      ) : lists.isError ? (
        <FormError message={message(lists.error)} />
      ) : lists.data.lists.length === 0 ? (
        <p className="text-slate-700 dark:text-slate-300">
          No lists yet. Create one above or start from a template.
        </p>
      ) : (
        <ul className="space-y-3" aria-label="Your lists">
          {lists.data.lists.map((l) => (
            <ListCard key={l.id} list={l} />
          ))}
        </ul>
      )}
      <div className={`${card} text-sm`}>
        <HealthStatus />
      </div>
    </section>
  );
}

function TemplateCard({ t }: { t: ListSummary }) {
  const [open, setOpen] = useState(false);
  const detail = useTemplate(t.id, open);
  const create = useCreateList();
  const navigate = useNavigate();
  const items = detail.data?.groups.flatMap((g) => g.items) ?? [];
  return (
    <li className={`${card} space-y-3`}>
      <div>
        <p className="flex flex-wrap items-center gap-2 font-semibold">
          {t.name}
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">
            {t.system ? 'Starter' : 'Mine'}
          </span>
        </p>
        {t.description ? (
          <p className="text-sm text-slate-600 dark:text-slate-400">{t.description}</p>
        ) : null}
        <p className="text-sm text-slate-600 dark:text-slate-400">{t.itemCount} items</p>
      </div>
      {open ? (
        detail.isPending ? (
          <Spinner label="Loading items…" />
        ) : (
          <ul className="list-disc space-y-0.5 pl-5 text-sm" aria-label={`${t.name} items`}>
            {items.map((i) => (
              <li key={i.id}>
                {i.product?.name ?? i.rawText}
                <span className="text-slate-600 dark:text-slate-400"> {formatQuantity(i)}</span>
              </li>
            ))}
          </ul>
        )
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={secondaryButton}
          aria-expanded={open}
          onClick={() => {
            setOpen((o) => !o);
          }}
        >
          {open ? 'Hide items' : 'Preview'}
        </button>
        <button
          type="button"
          className={`${primaryButton} w-auto`}
          disabled={create.isPending}
          onClick={() => {
            create.mutate(
              { name: t.name, fromTemplateId: t.id },
              { onSuccess: (l) => void navigate(`/lists/${l.id}`) },
            );
          }}
        >
          Use “{t.name}”
        </button>
      </div>
      <FormError message={message(create.error)} />
    </li>
  );
}

export function TemplatesPage() {
  const templates = useTemplates();
  return (
    <section aria-labelledby="tpl-h" className="space-y-4">
      <p>
        <Link to="/" className="text-sm font-medium text-brand-700 underline dark:text-brand-100">
          ← My Lists
        </Link>
      </p>
      <h1 id="tpl-h" className="text-2xl font-bold tracking-tight">
        Templates
      </h1>
      {templates.isPending ? (
        <Spinner label="Loading templates…" />
      ) : templates.isError ? (
        <FormError message={message(templates.error)} />
      ) : (
        <ul className="space-y-3">
          {templates.data.map((t) => (
            <TemplateCard key={t.id} t={t} />
          ))}
        </ul>
      )}
    </section>
  );
}
