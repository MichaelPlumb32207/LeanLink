import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { FlatCompat } from '@eslint/eslintrc';

// eslint-config-next 15.x still ships eslintrc-format configs (not flat-config
// arrays), so they must be loaded through FlatCompat until the v16 upgrade.
const compat = new FlatCompat({
  baseDirectory: dirname(fileURLToPath(import.meta.url)),
});

const eslintConfig = [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    // `.claude/worktrees/**` are linked git worktrees (full repo copies incl.
    // their own `.next/`) that background agents create inside the repo — never
    // lint them, or `eslint .` drowns in another checkout's build artifacts.
    ignores: ['.next/**', 'out/**', 'build/**', 'next-env.d.ts', '.claude/**'],
  },
];

export default eslintConfig;
