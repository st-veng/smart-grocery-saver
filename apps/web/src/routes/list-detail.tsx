import type { ListDetail, ListItem, UpdateItemRequest } from '@sgs/shared';
import { useId, useState, type SyntheticEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ProductSearch } from '../components/ProductSearch';
import { card, Field, FormError, primaryButton, secondaryButton, Spinner } from '../components/ui';
import { ApiError, fieldErrors } from '../lib/api';
import { formatNumber, formatQuantity, UNIT_LABEL, unitsFor } from '../lib/format';
import {
  useAddItem,
  useDeleteItem,
  useDeleteList,
  useDuplicateList,
  useList,
  useReorder,
  useSaveAsTemplate,
  useUpdateItem,
  useUpdateList,
} from '../lib/lists';

const message = (e: unknown) =>
  e instanceof ApiError ? e.message : e ? 'Something went wrong' : null;
const smallButton =
  'inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg px-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-200 dark:hover:bg-slate-800';

/** Visual order: groups in aisle order, items by position — the order reorder buttons act on. */
function visualOrder(list: ListDetail): ListItem[] {
  return list.groups.flatMap((g) => g.items);
}

function ItemEditor({
  listId,
  item,
  onClose,
}: {
  listId: string;
  item: ListItem;
  onClose: () => void;
}) {
  const update = useUpdateItem(listId);
  const del = useDeleteItem(listId);
  const [qty, setQty] = useState(formatNumber(item.quantity));
  const [unit, setUnit] = useState(item.unit ?? '');
  const [brand, setBrand] = useState(item.brand ?? '');
  const [notes, setNotes] = useState(item.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const unitId = useId();
  const submit = (e: SyntheticEvent) => {
    e.preventDefault();
    const q = Number(qty);
    if (!(q > 0) || q > 9999) {
      setError('Enter a quantity above 0');
      return;
    }
    setError(null);
    const patch: UpdateItemRequest = { quantity: q, notes: notes.trim() || null };
    if (item.product) {
      patch.unit = unit === '' ? null : (unit as NonNullable<ListItem['unit']>);
      patch.brand = brand.trim() || null;
    }
    update.mutate({ itemId: item.id, patch }, { onSuccess: onClose });
  };
  const server = fieldErrors(update.error);
  return (
    <form
      onSubmit={submit}
      noValidate
      className="mt-2 space-y-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-950"
    >
      <div className="grid grid-cols-2 gap-3">
        <Field
          label="Quantity"
          inputMode="decimal"
          value={qty}
          onChange={(e) => {
            setQty(e.target.value);
          }}
          error={server.quantity}
        />
        {item.product ? (
          <div className="space-y-1">
            <label
              htmlFor={unitId}
              className="block text-sm font-medium text-slate-800 dark:text-slate-200"
            >
              Unit
            </label>
            <select
              id={unitId}
              value={unit}
              onChange={(e) => {
                setUnit(e.target.value);
              }}
              className="block min-h-11 w-full rounded-xl border border-slate-300 bg-white px-2 dark:border-slate-700 dark:bg-slate-900"
            >
              <option value="">
                packages ({formatNumber(item.product.defaultQuantity)}{' '}
                {UNIT_LABEL[item.product.defaultUnit]})
              </option>
              {unitsFor(item.product).map((u) => (
                <option key={u} value={u}>
                  {UNIT_LABEL[u]}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>
      {item.product ? (
        <Field
          label="Brand (optional)"
          value={brand}
          onChange={(e) => {
            setBrand(e.target.value);
          }}
          hint="Leave blank to compare any brand."
        />
      ) : null}
      <Field
        label="Notes"
        value={notes}
        onChange={(e) => {
          setNotes(e.target.value);
        }}
      />
      <FormError message={error ?? message(update.error ?? del.error)} />
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={`${primaryButton} w-auto`} disabled={update.isPending}>
          Save
        </button>
        <button type="button" className={secondaryButton} onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className={`${secondaryButton} text-red-700 dark:text-red-300`}
          disabled={del.isPending}
          onClick={() => {
            del.mutate(item.id);
          }}
        >
          Remove
        </button>
      </div>
    </form>
  );
}

function ItemRow({
  listId,
  item,
  canUp,
  canDown,
  onMove,
}: {
  listId: string;
  item: ListItem;
  canUp: boolean;
  canDown: boolean;
  onMove: (dir: -1 | 1) => void;
}) {
  const update = useUpdateItem(listId);
  const [editing, setEditing] = useState(false);
  // Optimistic check state: flips on click, cleared once the server round-trip (and refetch) settles.
  const [pendingCheck, setPendingCheck] = useState<boolean | null>(null);
  const checked = pendingCheck ?? item.checked;
  const name = item.product?.name ?? item.rawText;
  const qty = formatQuantity(item);
  return (
    <li className="py-1">
      <div className="flex items-center gap-1">
        <label className="flex min-h-11 flex-1 items-center gap-3">
          <input
            type="checkbox"
            className="size-5 shrink-0 accent-brand-700"
            checked={checked}
            onChange={(e) => {
              setPendingCheck(e.target.checked);
              update.mutate(
                { itemId: item.id, patch: { checked: e.target.checked } },
                {
                  onSettled: () => {
                    setPendingCheck(null);
                  },
                },
              );
            }}
          />
          <span
            className={`flex-1 ${checked ? 'text-slate-500 line-through dark:text-slate-400' : ''}`}
          >
            {name}
            {qty ? ' ' : null}
            {qty ? (
              <span className="ml-2 text-sm text-slate-600 dark:text-slate-400">{qty}</span>
            ) : null}
            {item.brand ? ' ' : null}
            {item.brand ? (
              <span className="ml-2 text-sm text-slate-600 dark:text-slate-400">
                · {item.brand}
              </span>
            ) : null}
            {!item.product ? ' ' : null}
            {!item.product ? (
              <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900 dark:bg-amber-900 dark:text-amber-100">
                not priced
              </span>
            ) : null}
            {item.notes ? (
              <span className="block text-sm text-slate-600 dark:text-slate-400">{item.notes}</span>
            ) : null}
          </span>
        </label>
        <button
          type="button"
          className={smallButton}
          aria-label={`Move ${name} up`}
          disabled={!canUp}
          onClick={() => {
            onMove(-1);
          }}
        >
          <span aria-hidden="true">↑</span>
        </button>
        <button
          type="button"
          className={smallButton}
          aria-label={`Move ${name} down`}
          disabled={!canDown}
          onClick={() => {
            onMove(1);
          }}
        >
          <span aria-hidden="true">↓</span>
        </button>
        <button
          type="button"
          className={smallButton}
          aria-expanded={editing}
          aria-label={`Edit ${name}`}
          onClick={() => {
            setEditing((e) => !e);
          }}
        >
          Edit
        </button>
      </div>
      {editing ? (
        <ItemEditor
          listId={listId}
          item={item}
          onClose={() => {
            setEditing(false);
          }}
        />
      ) : null}
    </li>
  );
}

function ListActions({ list }: { list: ListDetail }) {
  const navigate = useNavigate();
  const rename = useUpdateList(list.id);
  const dup = useDuplicateList(list.id);
  const tpl = useSaveAsTemplate(list.id);
  const del = useDeleteList();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(list.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      {renaming ? (
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            rename.mutate(
              { name: name.trim() },
              {
                onSuccess: () => {
                  setRenaming(false);
                },
              },
            );
          }}
        >
          <div className="flex-1">
            <Field
              label="List name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
              error={fieldErrors(rename.error).name}
            />
          </div>
          <button type="submit" className={`${primaryButton} w-auto`}>
            Save
          </button>
        </form>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Link to={`/lists/${list.id}/import`} className={secondaryButton}>
          Import items
        </Link>
        <button
          type="button"
          className={secondaryButton}
          onClick={() => {
            setRenaming((r) => !r);
          }}
        >
          Rename
        </button>
        <button
          type="button"
          className={secondaryButton}
          onClick={() => {
            dup.mutate(undefined, { onSuccess: (l) => void navigate(`/lists/${l.id}`) });
          }}
        >
          Duplicate
        </button>
        <button
          type="button"
          className={secondaryButton}
          onClick={() => {
            tpl.mutate(undefined, {
              onSuccess: () => {
                setNotice('Saved as a template.');
              },
            });
          }}
        >
          Save as template
        </button>
        <button
          type="button"
          className={secondaryButton}
          onClick={() => {
            rename.mutate(
              { archived: !list.archived },
              { onSuccess: (l) => (l.archived ? void navigate('/') : undefined) },
            );
          }}
        >
          {list.archived ? 'Unarchive' : 'Archive'}
        </button>
        {confirmDelete ? (
          <span className="flex items-center gap-2">
            <button
              type="button"
              className={`${secondaryButton} text-red-700 dark:text-red-300`}
              onClick={() => {
                del.mutate(list.id, { onSuccess: () => void navigate('/') });
              }}
            >
              Yes, delete
            </button>
            <button
              type="button"
              className={secondaryButton}
              onClick={() => {
                setConfirmDelete(false);
              }}
            >
              Keep
            </button>
          </span>
        ) : (
          <button
            type="button"
            className={`${secondaryButton} text-red-700 dark:text-red-300`}
            onClick={() => {
              setConfirmDelete(true);
            }}
          >
            Delete
          </button>
        )}
      </div>
      {notice ? (
        <p role="status" className="text-sm font-medium text-brand-700 dark:text-brand-100">
          {notice}
        </p>
      ) : null}
      <FormError message={message(dup.error ?? tpl.error ?? del.error ?? rename.error)} />
    </div>
  );
}

export function ListDetailPage() {
  const { id = '' } = useParams();
  const list = useList(id);
  const add = useAddItem(id);
  const reorder = useReorder(id);
  const [lastAdded, setLastAdded] = useState<string | null>(null);

  if (list.isPending) return <Spinner label="Loading list…" />;
  if (list.isError) {
    return (
      <section className="space-y-4">
        <FormError
          message={
            list.error instanceof ApiError && list.error.status === 404
              ? 'That list does not exist.'
              : message(list.error)
          }
        />
        <Link to="/" className={secondaryButton}>
          Back to my lists
        </Link>
      </section>
    );
  }
  const data = list.data;
  const order = visualOrder(data);

  /** Swap with the neighbour in the same aisle group (moving across groups would change nothing visible). */
  const move = (groupItems: readonly ListItem[], k: number, dir: -1 | 1) => {
    const a = groupItems[k];
    const b = groupItems[k + dir];
    if (!a || !b) return;
    const ids = order.map((x) => x.id);
    const i = ids.indexOf(a.id);
    const j = ids.indexOf(b.id);
    ids[i] = b.id;
    ids[j] = a.id;
    reorder.mutate(ids);
  };

  return (
    <section aria-labelledby="list-h" className="space-y-4">
      <p>
        <Link to="/" className="text-sm font-medium text-brand-700 underline dark:text-brand-100">
          ← My Lists
        </Link>
      </p>
      <div>
        <h1 id="list-h" className="text-2xl font-bold tracking-tight">
          {data.name}
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {data.itemCount} items · {data.checkedCount} checked{data.archived ? ' · archived' : ''}
        </p>
      </div>
      {data.itemCount > 0 ? (
        <Link to={`/lists/${data.id}/compare`} className={primaryButton}>
          <span aria-hidden="true">⇄ </span>Compare prices
        </Link>
      ) : null}
      <div className={card}>
        {/* Not disabled while saving: disabling blurs the input and closes suggestions mid-typing. */}
        <ProductSearch
          onPick={(p) => {
            add.mutate(
              { rawText: p.name, productId: p.id },
              {
                onSuccess: () => {
                  setLastAdded(p.name);
                },
              },
            );
          }}
          onFreeText={(text) => {
            add.mutate(
              { rawText: text },
              {
                onSuccess: () => {
                  setLastAdded(text);
                },
              },
            );
          }}
        />
        <p role="status" className="sr-only">
          {lastAdded ? `Added ${lastAdded}` : ''}
        </p>
        <FormError message={message(add.error ?? reorder.error)} />
      </div>
      {data.groups.length === 0 ? (
        <p className="text-slate-700 dark:text-slate-300">
          This list is empty. Add items above, or import a list.
        </p>
      ) : (
        data.groups.map((g) => (
          <section
            key={g.categoryId ?? 'other'}
            aria-labelledby={`g-${String(g.categoryId ?? 'other')}`}
            className={card}
          >
            <h2
              id={`g-${String(g.categoryId ?? 'other')}`}
              className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400"
            >
              {g.categoryName}
            </h2>
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {g.items.map((item, k) => (
                <ItemRow
                  key={item.id}
                  listId={data.id}
                  item={item}
                  canUp={k > 0 && !reorder.isPending}
                  canDown={k < g.items.length - 1 && !reorder.isPending}
                  onMove={(dir) => {
                    move(g.items, k, dir);
                  }}
                />
              ))}
            </ul>
          </section>
        ))
      )}
      <div className={card}>
        <ListActions list={data} />
      </div>
    </section>
  );
}
