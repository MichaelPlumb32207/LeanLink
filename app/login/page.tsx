'use client';

import { signIn } from 'next-auth/react';

export default function LoginPage() {
  return (
    <main className="min-h-screen theme-matrix flex items-center justify-center p-8">
      <div className="panel max-w-md w-full rounded-2xl p-8 shadow-2xl">
        <h1 className="text-3xl font-bold mb-2">LeanLink Login</h1>
        <p className="mb-6 opacity-80 text-sm">Restricted to authorized user.</p>
        <button
          onClick={() => signIn('google', { callbackUrl: '/dashboard' })}
          className="w-full rounded-lg bg-white px-4 py-3 font-medium text-zinc-900 hover:bg-zinc-100"
        >
          Continue with Google
        </button>
      </div>
    </main>
  );
}