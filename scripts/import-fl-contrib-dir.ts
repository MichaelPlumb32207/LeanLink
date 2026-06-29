/**
 * Import all flc_*.tsv chunks from a directory into Neon reference index.
 *
 * Usage:
 *   npx tsx scripts/import-fl-contrib-dir.ts --dir data/reference/fl-contrib --label 2008-2026
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { importFlContribDirectory } from '@/lib/reference-data/import-fl-contrib-dir';

function loadEnvLocal() {
  try {
    const raw = readFileSync(join(process.cwd(), '.env.local'), 'utf8');
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq === -1) continue;
      const key = t.slice(0, eq).trim();
      let val = t.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    /* no .env.local */
  }
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  loadEnvLocal();
  const dir = arg('--dir') ?? join(process.cwd(), 'data', 'reference', 'fl-contrib');
  const label = arg('--label') ?? 'fl-contrib-index';
  const from = arg('--from');
  const to = arg('--to');

  console.log(`Importing ${dir} → snapshot "${label}"…`);
  const result = await importFlContribDirectory({
    dirPath: dir,
    label,
    dateFrom: from,
    dateTo: to,
    batchSize: 1000,
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});