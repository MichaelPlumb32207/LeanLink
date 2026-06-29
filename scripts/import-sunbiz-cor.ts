/**
 * Import Sunbiz quarterly corporate fixed-width file (extracted from cordata.zip).
 *
 * Usage:
 *   npx tsx scripts/import-sunbiz-cor.ts --file /path/to/cor0.txt --label 2026q2-cor0
 */
import { importSunbizCorFile } from '@/lib/reference-data/import-sunbiz';
import { readFileSync } from 'fs';
import { join } from 'path';

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
  const file = arg('--file');
  const label = arg('--label');
  if (!file || !label) {
    console.error('Usage: npx tsx scripts/import-sunbiz-cor.ts --file PATH --label NAME');
    process.exit(1);
  }

  const result = await importSunbizCorFile({ filePath: file, label });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});