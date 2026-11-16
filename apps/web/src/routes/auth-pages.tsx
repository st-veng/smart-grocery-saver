import { LoginRequest, RegisterRequest } from '@sgs/shared';
import { useState, type SyntheticEvent, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { safeNext } from '../components/Guards';
import { ThemeToggle } from '../components/ThemeToggle';
import { Field, FormError, primaryButton, secondaryButton } from '../components/ui';
import { ApiError, fieldErrors } from '../lib/api';
import { GOOGLE_ERRORS, useLogin, useRegister } from '../lib/auth';

function zodErrors(
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of issues) {
    const k = String(i.path[0] ?? '');
    if (k && !(k in out)) out[k] = i.message;
  }
  return out;
}

function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-dvh px-4 py-6">
      <div className="mx-auto flex max-w-md justify-end">
        <ThemeToggle />
      </div>
      <main id="main" className="mx-auto mt-6 max-w-md space-y-6">
        <p className="flex items-center gap-2 text-lg font-semibold">
          <span aria-hidden="true">🛒</span> Smart Grocery Saver
        </p>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {children}
      </main>
    </div>
  );
}

function GoogleButton({ next }: { next: string }) {
  return (
    <a
      href={`/api/v1/auth/google?returnTo=${encodeURIComponent(next)}`}
      className={`${secondaryButton} w-full gap-2`}
    >
      <span aria-hidden="true" className="font-bold text-blue-600 dark:text-blue-400">
        G
      </span>
      Continue with Google
    </a>
  );
}

function Divider() {
  return (
    <div
      className="flex items-center gap-3 text-sm text-slate-600 dark:text-slate-400"
      aria-hidden="true"
    >
      <span className="h-px flex-1 bg-slate-300 dark:bg-slate-700" />
      or
      <span className="h-px flex-1 bg-slate-300 dark:bg-slate-700" />
    </div>
  );
}

export function LoginPage() {
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const login = useLogin();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const googleError = GOOGLE_ERRORS[params.get('error') ?? ''];

  const submit = (e: SyntheticEvent) => {
    e.preventDefault();
    const parsed = LoginRequest.safeParse({ email, password });
    if (!parsed.success) {
      setErrors(zodErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    login.mutate(parsed.data);
  };
  const serverError =
    login.error instanceof ApiError
      ? login.error.message
      : login.error
        ? 'Something went wrong'
        : null;

  return (
    <AuthLayout title="Sign in">
      <GoogleButton next={next} />
      <Divider />
      <form onSubmit={submit} noValidate className="space-y-4">
        <FormError message={googleError ?? serverError} />
        <Field
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
          }}
          error={errors.email}
        />
        <Field
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
          }}
          error={errors.password}
        />
        <button type="submit" className={primaryButton} disabled={login.isPending}>
          {login.isPending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <p className="text-center text-slate-700 dark:text-slate-300">
        New here?{' '}
        <Link
          to={`/register${params.get('next') ? `?next=${encodeURIComponent(next)}` : ''}`}
          className="font-semibold text-brand-700 underline dark:text-brand-100"
        >
          Create an account
        </Link>
      </p>
    </AuthLayout>
  );
}

export function RegisterPage() {
  const register = useRegister();
  const [form, setForm] = useState({ displayName: '', email: '', password: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
  };

  const submit = (e: SyntheticEvent) => {
    e.preventDefault();
    const parsed = RegisterRequest.safeParse(form);
    if (!parsed.success) {
      setErrors(zodErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    register.mutate(parsed.data);
  };
  const server = fieldErrors(register.error);
  const serverError =
    register.error instanceof ApiError
      ? register.error.message
      : register.error
        ? 'Something went wrong'
        : null;

  return (
    <AuthLayout title="Create your account">
      <GoogleButton next="/" />
      <Divider />
      <form onSubmit={submit} noValidate className="space-y-4">
        <FormError message={serverError} />
        <Field
          label="Your name"
          autoComplete="name"
          value={form.displayName}
          onChange={set('displayName')}
          error={errors.displayName ?? server.displayName}
        />
        <Field
          label="Email"
          type="email"
          autoComplete="email"
          value={form.email}
          onChange={set('email')}
          error={errors.email ?? server.email}
        />
        <Field
          label="Password"
          type="password"
          autoComplete="new-password"
          value={form.password}
          onChange={set('password')}
          error={errors.password ?? server.password}
          hint="At least 10 characters."
        />
        <button type="submit" className={primaryButton} disabled={register.isPending}>
          {register.isPending ? 'Creating account…' : 'Create account'}
        </button>
      </form>
      <p className="text-center text-slate-700 dark:text-slate-300">
        Already have an account?{' '}
        <Link to="/login" className="font-semibold text-brand-700 underline dark:text-brand-100">
          Sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
