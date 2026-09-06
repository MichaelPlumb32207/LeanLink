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
        <h1 className="text-4xl font-bold mb-3">LeanLink</h1>
        <p className="mb-4 opacity-90">
          Public-records lean inference for Florida voter lists. Research and
          validation — not outreach.
        </p>
        <p className="mb-4 text-sm opacity-70">
          A{' '}
          <a
            href="https://four-plums.com"
            className="underline hover:opacity-100"
            target="_blank"
            rel="noreferrer"
          >
            Four Plums
          </a>{' '}
          project. Open source (MIT) —{' '}
          <a
            href="mailto:Michael@Four-Plums.com"
            className="underline hover:opacity-100"
          >
            Michael@Four-Plums.com
          </a>
        </p>
        <p className="mb-8 text-xs opacity-60 break-all">
          Donations/tips appreciated:{' '}
          <a
            href="bitcoin:bc1qac237n8ekdr370ueyv8795fmm3gerdd5n27ahr"
            className="font-mono underline hover:opacity-100"
          >
            bc1qac237n8ekdr370ueyv8795fmm3gerdd5n27ahr
          </a>
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