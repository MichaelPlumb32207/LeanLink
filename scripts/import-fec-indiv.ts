/**
 * Load a FEC bulk individual-contributions cycle (Florida-filtered) into Neon.
 *
 * Get the files first (example: 2023–2024 cycle):
 *   curl -LO https://www.fec.gov/files/bulk-downloads/2024/indiv24.zip
 *   curl -LO https://www.fec.gov/files/bulk-downloads/2024/cm24.zip
 *   unzip indiv24.zip   # → itcont.txt
 *   unzip cm24.zip      # → cm.txt
 *
 * Then:
 *   npx tsx scripts/import-fec-indiv.ts --file itcont.txt --committees cm.txt --label 2024-fl
 *
 * Interrupted? Just re-run the same command — it resumes (already-loaded rows
 * are skipped via the unique sub_id key). Add --fresh to wipe and reload.
 * Track progress any time, from any terminal:
 *   node scripts/fec-indiv-status.mjs
 *
 * Backfilling older cycles? Load each under its OWN label (2022-fl, 2020-fl):
 *   npx tsx scripts/import-fec-indiv.ts --file itcont.txt --committees cm.txt --label 2022-fl
 * The match path (run-fec-index / dashboard button) searches ALL completed
 * fec_indiv snapshots at once, so each backfilled cycle raises the hit rate
 * with no per-cycle "which snapshot?" decision. See docs/SETUP.md §8a.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { importFecIndiv } from '@/lib/reference-data/import-fec-indiv';
import { keepAwakeWhileRunning } from '@/lib/cli/keep-awake';

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
    /* optional */
  }
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  loadEnvLocal();
  keepAwakeWhileRunning('the FEC bulk load');
  const filePath = arg('--file');
  const committeesPath = arg('--committees');
  const label = arg('--label');
  const fresh = process.argv.includes('--fresh');

  if (!filePath || !committeesPath || !label) {
    console.error(
      'Usage: npx tsx scripts/import-fec-indiv.ts --file itcont.txt --committees cm.txt --label 2024-fl [--fresh]',
    );
    process.exit(1);
  }

  const result = await importFecIndiv({ filePath, committeesPath, label, fresh });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
