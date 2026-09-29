'use client';

import { ROLE_LABELS } from '@cpos/shared';
import { LogOut, Menu, Moon, Sun, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/misc';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { NAV } from './nav';

function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark' | null>(null);
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem('cpos.theme');
    } catch {
      /* ignore */
    }
    const initial = saved === 'dark' || saved === 'light' ? saved : window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    setTheme(initial);
    document.documentElement.dataset.theme = initial;
  }, []);
  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('cpos.theme', next);
    } catch {
      /* ignore */
    }
  };
  return (
    <Button variant="ghost" size="icon" onClick={toggle} aria-label="Сменить тему">
      {theme === 'dark' ? <Sun /> : <Moon />}
    </Button>
  );
}

export function DashboardShell({ children }: { children: ReactNode }) {
  const { user, company, loading, logout, can } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);
  useEffect(() => setOpen(false), [pathname]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Skeleton className="h-8 w-48" />
      </div>
    );
  }

  const items = NAV.filter((n) => can(n.permission));
  const nav = (
    <nav className="flex flex-col gap-0.5 p-3" aria-label="Основная навигация">
      {items.map((item) => {
        const active = item.href === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <item.icon className="size-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="flex min-h-screen">
      {/* desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r bg-sidebar lg:flex">
        <div className="flex h-14 items-center gap-2 border-b px-5">
          <div className="flex size-7 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">C</div>
          <span className="font-semibold">Clopos Manager</span>
        </div>
        <div className="flex-1 overflow-y-auto">{nav}</div>
        <div className="border-t p-3 text-xs text-muted-foreground">{company?.timezone}</div>
      </aside>

      {/* mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button type="button" aria-label="Закрыть меню" className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 overflow-y-auto border-r bg-sidebar">
            <div className="flex h-14 items-center justify-between border-b px-4">
              <span className="font-semibold">Clopos Manager</span>
              <Button variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="Закрыть меню">
                <X />
              </Button>
            </div>
            {nav}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/90 px-4 backdrop-blur lg:px-8">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(true)} aria-label="Открыть меню">
            <Menu />
          </Button>
          <div className="min-w-0 flex-1 truncate text-sm font-medium">{company?.name}</div>
          <ThemeToggle />
          <div className="hidden text-right sm:block">
            <p className="text-sm font-medium leading-tight">{user.name}</p>
            <p className="text-xs text-muted-foreground">{ROLE_LABELS[user.role]}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={logout} aria-label="Выйти">
            <LogOut />
          </Button>
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
