import { useState, type SyntheticEvent } from 'react';
import { useNavigate } from 'react-router';
import { StoresForm } from '../components/StoresForm';
import { ThemeToggle } from '../components/ThemeToggle';
import { card, Field, FormError, primaryButton, secondaryButton, Spinner } from '../components/ui';
import { ApiError, fieldErrors } from '../lib/api';
import { useMe, useMyStores, useSaveMyStores, useUpdateProfile } from '../lib/auth';

const STEPS = ['Where', 'Stores', 'Car'] as const;
const message = (e: unknown) =>
  e instanceof ApiError ? e.message : e ? 'Something went wrong' : null;

function ZipStep({ onDone }: { onDone: () => void }) {
  const me = useMe();
  const update = useUpdateProfile();
  const [zip, setZip] = useState(me.data?.homeZip ?? '');
  const [error, setError] = useState<string | undefined>();
  const submit = (e: SyntheticEvent) => {
    e.preventDefault();
    if (!/^\d{5}$/.test(zip)) {
      setError('Enter a 5-digit ZIP code');
      return;
    }
    setError(undefined);
    update.mutate({ homeZip: zip }, { onSuccess: onDone });
  };
  const server = fieldErrors(update.error);
  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <p className="text-slate-700 dark:text-slate-300">
        We use your ZIP code to find stores near you and estimate driving costs.
      </p>
      <Field
        label="Home ZIP code"
        inputMode="numeric"
        autoComplete="postal-code"
        maxLength={5}
        value={zip}
        onChange={(e) => {
          setZip(e.target.value.replace(/\D/g, ''));
        }}
        error={error ?? server.homeZip}
      />
      <FormError message={server.homeZip ? null : message(update.error)} />
      <button type="submit" className={primaryButton} disabled={update.isPending}>
        {update.isPending ? 'Saving…' : 'Continue'}
      </button>
    </form>
  );
}

function StoresStep({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const me = useMe();
  const stores = useMyStores();
  const save = useSaveMyStores();
  const update = useUpdateProfile();
  if (stores.isPending) return <Spinner label="Finding stores near you…" />;
  if (stores.isError) return <FormError message={message(stores.error)} />;
  return (
    <div className="space-y-4">
      <StoresForm
        key={stores.dataUpdatedAt}
        data={stores.data}
        baselineStoreId={me.data?.baselineStoreId ?? null}
        submitLabel="Continue"
        pending={save.isPending || update.isPending}
        error={message(save.error ?? update.error)}
        onSubmit={(rows, baselineStoreId) => {
          save.mutate(
            { stores: rows },
            {
              onSuccess: () => {
                update.mutate({ baselineStoreId }, { onSuccess: onDone });
              },
            },
          );
        }}
      />
      <button type="button" onClick={onBack} className={`${secondaryButton} w-full`}>
        Back
      </button>
    </div>
  );
}

function CarStep({ onBack }: { onBack: () => void }) {
  const me = useMe();
  const update = useUpdateProfile();
  const navigate = useNavigate();
  const [mpg, setMpg] = useState(String(me.data?.vehicleMpg ?? 25));
  const [error, setError] = useState<string | undefined>();
  const submit = (e: SyntheticEvent) => {
    e.preventDefault();
    const n = Number(mpg);
    if (!Number.isFinite(n) || n <= 0 || n > 150) {
      setError('Enter your car’s miles per gallon (1–150)');
      return;
    }
    setError(undefined);
    update.mutate(
      { vehicleMpg: n, completeOnboarding: true },
      {
        onSuccess: () => {
          void navigate('/', { replace: true });
        },
      },
    );
  };
  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <p className="text-slate-700 dark:text-slate-300">
        We include fuel cost when deciding whether an extra store stop is worth it.
      </p>
      <Field
        label="Miles per gallon"
        inputMode="decimal"
        value={mpg}
        onChange={(e) => {
          setMpg(e.target.value);
        }}
        error={error}
      />
      <FormError message={message(update.error)} />
      <button type="submit" className={primaryButton} disabled={update.isPending}>
        {update.isPending ? 'Saving…' : 'Finish setup'}
      </button>
      <button type="button" onClick={onBack} className={`${secondaryButton} w-full`}>
        Back
      </button>
    </form>
  );
}

export function OnboardingPage() {
  const me = useMe();
  const [step, setStep] = useState(me.data?.homeZip ? 1 : 0);
  return (
    <div className="min-h-dvh px-4 py-6">
      <div className="mx-auto flex max-w-md justify-end">
        <ThemeToggle />
      </div>
      <main id="main" className="mx-auto mt-4 max-w-md space-y-5">
        <p className="text-sm font-medium text-slate-600 dark:text-slate-400">
          Step {step + 1} of {STEPS.length}
        </p>
        <h1 className="text-2xl font-bold tracking-tight">
          {step === 0 ? 'Where do you shop from?' : step === 1 ? 'Pick your stores' : 'Your car'}
        </h1>
        <ol className="flex gap-2" aria-label="Setup progress">
          {STEPS.map((s, i) => (
            <li
              key={s}
              aria-current={i === step ? 'step' : undefined}
              className={`h-1.5 flex-1 rounded-full ${i <= step ? 'bg-brand-600' : 'bg-slate-300 dark:bg-slate-700'}`}
            >
              <span className="sr-only">
                {s}
                {i < step ? ' (done)' : ''}
              </span>
            </li>
          ))}
        </ol>
        <div className={card}>
          {step === 0 ? (
            <ZipStep
              onDone={() => {
                setStep(1);
              }}
            />
          ) : step === 1 ? (
            <StoresStep
              onDone={() => {
                setStep(2);
              }}
              onBack={() => {
                setStep(0);
              }}
            />
          ) : (
            <CarStep
              onBack={() => {
                setStep(1);
              }}
            />
          )}
        </div>
      </main>
    </div>
  );
}
