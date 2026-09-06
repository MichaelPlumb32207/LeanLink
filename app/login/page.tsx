'use client';

import { signIn } from 'next-auth/react';

export default function LoginPage() {
  return (
    <main className="min-h-screen theme-matrix flex items-center justify-center p-8">
      <div className="panel max-w-md w-full rounded-2xl p-8 shadow-2xl">
        <h1 className="text-3xl font-bold mb-2">LeanLink Login</h1>
        <p className="mb-2 opacity-80 text-sm">Restricted to the allowed Google account.</p>
        <p className="mb-2 text-xs opacity-60">
          <a href="https://four-plums.com" className="underline" target="_blank" rel="noreferrer">
            Four Plums
          </a>
          {' · '}
          <a href="mailto:Michael@Four-Plums.com" className="underline">
            Michael@Four-Plums.com
          </a>
        </p>
        <p className="mb-6 text-xs opacity-50 break-all">
          Tips:{' '}
          <a
            href="bitcoin:bc1qac237n8ekdr370ueyv8795fmm3gerdd5n27ahr"
            className="font-mono underline"
          >
            bc1qac237n8ekdr370ueyv8795fmm3gerdd5n27ahr
          </a>
        </p>
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