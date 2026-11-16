import { useState, type SyntheticEvent } from 'react';
import { useNavigate } from 'react-router';
import { StoresForm } from '../components/StoresForm';
import { card, Field, FormError, primaryButton, secondaryButton, Spinner } from '../components/ui';
import { ApiError, fieldErrors } from '../lib/api';
import { useLogout, useMe, useMyStores, useSaveMyStores, useUpdateProfile } from '../lib/auth';

const message = (e: unknown) =>
  e instanceof ApiError ? e.message : e ? 'Something went wrong' : null;

function Saved({ show }: { show: boolean }) {
  return show ? (
    <p role="status" className="text-sm font-medium text-brand-700 dark:text-brand-100">
      Saved
    </p>
  ) : null;
}

function ProfileSection() {
  const me = useMe();
  const update = useUpdateProfile();
  const [name, setName] = useState(me.data?.displayName ?? '');
  const [zip, setZip] = useState(me.data?.homeZip ?? '');
  const [mpg, setMpg] = useState(String(me.data?.vehicleMpg ?? 25));
  const [fuel, setFuel] = useState(
    me.data?.fuelCentsPerGal ? (me.data.fuelCentsPerGal / 100).toFixed(2) : '',
  );
  const [error, setError] = useState<string | null>(null);
  const submit = (e: SyntheticEvent) => {
    e.preventDefault();
    const mpgN = Number(mpg);
    const fuelN = fuel.trim() === '' ? null : Math.round(Number(fuel) * 100);
    if (!/^\d{5}$/.test(zip) || !(mpgN > 0) || (fuelN !== null && !(fuelN > 0))) {
      setError('Check the ZIP code, miles per gallon and fuel price.');
      return;
    }
    setError(null);
    update.mutate({
      displayName: name.trim(),
      homeZip: zip,
      vehicleMpg: mpgN,
      fuelCentsPerGal: fuelN,
    });
  };
  const server = fieldErrors(update.error);
  return (
    <section aria-labelledby="profile-h" className={`${card} space-y-4`}>
      <h2 id="profile-h" className="text-lg font-semibold">
        Profile
      </h2>
      <p className="text-sm text-slate-600 dark:text-slate-400">Signed in as {me.data?.email}</p>
      <form onSubmit={submit} noValidate className="space-y-4">
        <Field
          label="Name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
          }}
          autoComplete="name"
        />
        <Field
          label="Home ZIP code"
          inputMode="numeric"
          maxLength={5}
          value={zip}
          onChange={(e) => {
            setZip(e.target.value.replace(/\D/g, ''));
          }}
          error={server.homeZip}
        />
        <Field
          label="Car miles per gallon"
          inputMode="decimal"
          value={mpg}
          onChange={(e) => {
            setMpg(e.target.value);
          }}
        />
        <Field
          label="Fuel price ($/gal)"
          inputMode="decimal"
          placeholder="DFW average"
          value={fuel}
          onChange={(e) => {
            setFuel(e.target.value);
          }}
          hint="Leave blank to use the current DFW average."
        />
        <FormError message={error ?? (server.homeZip ? null : message(update.error))} />
        <button type="submit" className={primaryButton} disabled={update.isPending}>
          {update.isPending ? 'Saving…' : 'Save profile'}
        </button>
        <Saved show={update.isSuccess} />
      </form>
    </section>
  );
}

function StoresSection() {
  const me = useMe();
  const stores = useMyStores();
  const save = useSaveMyStores();
  const update = useUpdateProfile();
  return (
    <section aria-labelledby="stores-h" className={`${card} space-y-4`}>
      <h2 id="stores-h" className="text-lg font-semibold">
        Stores, memberships & cards
      </h2>
      {stores.isPending ? (
        <Spinner label="Loading stores…" />
      ) : stores.isError ? (
        <FormError message={message(stores.error)} />
      ) : (
        <>
          <StoresForm
            key={stores.dataUpdatedAt}
            data={stores.data}
            baselineStoreId={me.data?.baselineStoreId ?? null}
            submitLabel="Save stores"
            pending={save.isPending || update.isPending}
            error={message(save.error ?? update.error)}
            onSubmit={(rows, baselineStoreId) => {
              save.mutate(
                { stores: rows },
                {
                  onSuccess: () => {
                    update.mutate({ baselineStoreId });
                  },
                },
              );
            }}
          />
          <Saved show={save.isSuccess && update.isSuccess} />
        </>
      )}
    </section>
  );
}

export function SettingsPage() {
  const logout = useLogout();
  const navigate = useNavigate();
  return (
    <section aria-labelledby="settings-h" className="space-y-4">
      <h1 id="settings-h" className="text-2xl font-bold tracking-tight">
        Settings
      </h1>
      <ProfileSection />
      <StoresSection />
      <button
        type="button"
        className={`${secondaryButton} w-full`}
        onClick={() => {
          logout.mutate(undefined, { onSettled: () => void navigate('/login', { replace: true }) });
        }}
      >
        Sign out
      </button>
    </section>
  );
}
