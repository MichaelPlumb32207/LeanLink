import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';

export default async function HomePage() {
  const session = await getSession();
  if (session?.user?.email === process.env.ALLOWED_USER_EMAIL) {
    redirect('/dashboard');
  }

  return (
    <main className="min-h-screen theme-matrix flex items-center justify-center p-8">
      <div className="panel max-w-xl rounded-2xl p-10 text-center shadow-2xl">
        <h1 className="text-4xl font-bold mb-3">LeanLink NPA FL</h1>
        <p className="mb-8 opacity-90">
          Privacy-first lean inference for Florida NPA voter lists.
        </p>
        <Link
          href="/login"
          className="inline-block rounded-lg bg-emerald-600 px-6 py-3 font-medium text-white hover:bg-emerald-500"
        >
          Sign in with Google
        </Link>
      </div>
    </main>
  );
}