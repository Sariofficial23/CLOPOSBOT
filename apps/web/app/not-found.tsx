import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-5xl font-semibold">404</p>
      <p className="text-muted-foreground">Страница не найдена</p>
      <Link href="/dashboard" className="text-primary underline">
        На главную
      </Link>
    </main>
  );
}
