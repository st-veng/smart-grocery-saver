import type { MyStoresResponse, PutMyStoresRequest } from '@sgs/shared';
import { useId, useState, type SyntheticEvent } from 'react';
import { FormError, primaryButton } from './ui';

interface Row {
  enabled: boolean;
  hasMembership: boolean;
  hasLoyalty: boolean;
}

export interface StoresFormProps {
  readonly data: MyStoresResponse;
  readonly baselineStoreId: number | null;
  readonly submitLabel: string;
  readonly pending: boolean;
  readonly error: string | null;
  readonly onSubmit: (stores: PutMyStoresRequest['stores'], baselineStoreId: number) => void;
}

/** Store picker used by onboarding step 2 and Settings (SPEC S2/S11). */
export function StoresForm({
  data,
  baselineStoreId,
  submitLabel,
  pending,
  error,
  onSubmit,
}: StoresFormProps) {
  const [rows, setRows] = useState<Record<number, Row>>(() =>
    Object.fromEntries(
      data.stores.map((s) => [
        s.id,
        { enabled: s.enabled, hasMembership: s.hasMembership, hasLoyalty: s.hasLoyalty },
      ]),
    ),
  );
  const enabledIds = data.stores.filter((s) => rows[s.id]?.enabled).map((s) => s.id);
  const defaultBaseline =
    baselineStoreId ??
    data.stores.find((s) => s.slug === 'kroger' && rows[s.id]?.enabled)?.id ??
    enabledIds[0] ??
    null;
  const [baseline, setBaseline] = useState<number | null>(defaultBaseline);
  const [localError, setLocalError] = useState<string | null>(null);
  const selectId = useId();

  const update = (id: number, patch: Partial<Row>) => {
    setRows((r) => ({
      ...r,
      [id]: { ...(r[id] ?? { enabled: false, hasMembership: false, hasLoyalty: false }), ...patch },
    }));
  };

  const effectiveBaseline =
    baseline !== null && enabledIds.includes(baseline) ? baseline : (enabledIds[0] ?? null);

  const submit = (e: SyntheticEvent) => {
    e.preventDefault();
    if (enabledIds.length === 0 || effectiveBaseline === null) {
      setLocalError('Pick at least one store you shop at.');
      return;
    }
    setLocalError(null);
    onSubmit(
      data.stores.map((s) => {
        const r = rows[s.id] ?? { enabled: false, hasMembership: false, hasLoyalty: false };
        return {
          storeId: s.id,
          enabled: r.enabled,
          hasMembership: s.requiresMembership && r.hasMembership,
          hasLoyalty: s.loyaltyProgram !== null && r.hasLoyalty,
          preferredLocationId: s.preferredLocationId,
        };
      }),
      effectiveBaseline,
    );
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      {data.fallback ? (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
          No stores within {data.radiusMiles} mi, so we picked the 3 nearest.
        </p>
      ) : null}
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-semibold text-slate-800 dark:text-slate-200">
          Stores you shop at
        </legend>
        <ul className="divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
          {data.stores.map((s) => {
            const r = rows[s.id];
            const near = s.nearestLocation;
            return (
              <li key={s.id} className="space-y-2 px-3 py-2">
                <label className="flex min-h-11 items-center gap-3">
                  <input
                    type="checkbox"
                    className="size-5 accent-brand-700"
                    checked={r?.enabled ?? false}
                    onChange={(e) => {
                      update(s.id, { enabled: e.target.checked });
                    }}
                  />
                  <span className="flex-1">
                    <span className="font-medium">{s.name}</span>
                    {s.preselected ? (
                      <span className="ml-2 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-800 dark:bg-slate-800 dark:text-brand-100">
                        Nearby
                      </span>
                    ) : null}
                    <span className="block text-sm text-slate-600 dark:text-slate-400">
                      {near
                        ? `${near.distanceMiles.toFixed(1)} mi · ${near.name}`
                        : 'Add your ZIP to see distance'}
                    </span>
                  </span>
                </label>
                {r?.enabled && s.requiresMembership ? (
                  <label className="ml-8 flex min-h-11 items-center gap-3 text-sm">
                    <input
                      type="checkbox"
                      className="size-5 accent-brand-700"
                      checked={r.hasMembership}
                      onChange={(e) => {
                        update(s.id, { hasMembership: e.target.checked });
                      }}
                    />
                    I have a {s.name} membership
                  </label>
                ) : null}
                {r?.enabled && s.loyaltyProgram ? (
                  <label className="ml-8 flex min-h-11 items-center gap-3 text-sm">
                    <input
                      type="checkbox"
                      className="size-5 accent-brand-700"
                      checked={r.hasLoyalty}
                      onChange={(e) => {
                        update(s.id, { hasLoyalty: e.target.checked });
                      }}
                    />
                    Use my {s.loyaltyProgram} prices
                  </label>
                ) : null}
              </li>
            );
          })}
        </ul>
      </fieldset>
      <div className="space-y-1">
        <label
          htmlFor={selectId}
          className="block text-sm font-medium text-slate-800 dark:text-slate-200"
        >
          Your usual store
        </label>
        <select
          id={selectId}
          value={effectiveBaseline ?? ''}
          onChange={(e) => {
            setBaseline(Number(e.target.value));
          }}
          className="block min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-base dark:border-slate-700 dark:bg-slate-950"
        >
          {data.stores
            .filter((s) => rows[s.id]?.enabled)
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
        </select>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          We measure your savings against this store.
        </p>
      </div>
      <FormError message={localError ?? error} />
      <button type="submit" className={primaryButton} disabled={pending}>
        {pending ? 'Saving…' : submitLabel}
      </button>
    </form>
  );
}
