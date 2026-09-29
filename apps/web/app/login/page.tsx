'use client';

import { loginSchema } from '@cpos/shared';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/misc';
import { errorText } from '@/lib/api';
import { useAuth } from '@/lib/auth';

const BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;

declare global {
  interface Window {
    onTelegramAuth?: (user: Record<string, unknown>) => void;
  }
}

function TelegramLogin({ onAuth }: { onAuth: (u: Record<string, unknown>) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef(onAuth);
  cb.current = onAuth;
  useEffect(() => {
    if (!BOT_USERNAME || !ref.current) return;
    window.onTelegramAuth = (u) => cb.current(u);
    const s = document.createElement('script');
    s.src = 'https://telegram.org/js/telegram-widget.js?22';
    s.async = true;
    s.setAttribute('data-telegram-login', BOT_USERNAME);
    s.setAttribute('data-size', 'large');
    s.setAttribute('data-request-access', 'write');
    s.setAttribute('data-onauth', 'onTelegramAuth(user)');
    ref.current.appendChild(s);
    const node = ref.current;
    return () => {
      node.innerHTML = '';
      delete window.onTelegramAuth;
    };
  }, []);
  if (!BOT_USERNAME) return null;
  return <div ref={ref} className="flex justify-center" />;
}

export default function LoginPage() {
  const { login, loginWithTelegram, user, loading } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user) router.replace('/dashboard');
  }, [loading, user, router]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await login(parsed.data.email, parsed.data.password);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-primary text-lg font-bold text-primary-foreground">C</div>
          <CardTitle className="text-xl">Clopos Manager</CardTitle>
          <CardDescription>Вход в панель управления</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
            {error && <Alert variant="error">{error}</Alert>}
            <Field label="Email" error={errors.email}>
              <Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="Пароль" error={errors.password}>
              <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <Button type="submit" disabled={busy}>
              {busy ? 'Входим…' : 'Войти'}
            </Button>
          </form>
          {BOT_USERNAME && (
            <div className="mt-6 border-t pt-6">
              <p className="mb-3 text-center text-xs text-muted-foreground">или</p>
              <TelegramLogin
                onAuth={(u) => {
                  setError(null);
                  loginWithTelegram(u).catch((err) => setError(errorText(err)));
                }}
              />
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
