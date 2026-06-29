/**
 * Download FL DOS campaign finance contributions (monthly tab-delimited chunks).
 *
 * Usage:
 *   npx tsx scripts/download-fl-contrib.ts
 *   npx tsx scripts/download-fl-contrib.ts --from 2008-01-01 --to 2026-06-29
 *   npx tsx scripts/download-fl-contrib.ts --full   # from 1995-01-01
 */
import { downloadFlContribRange } from '@/lib/fl-contrib/download';
import { join } from 'path';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const full = process.argv.includes('--full');
  const fromStr = arg('--from') ?? (full ? '1995-01-01' : '2008-01-01');
  const toStr = arg('--to') ?? new Date().toISOString().slice(0, 10);
  const outDir = arg('--out') ?? join(process.cwd(), 'data', 'reference', 'fl-contrib');

  const from = new Date(`${fromStr}T12:00:00`);
  const thru = new Date(`${toStr}T12:00:00`);

  console.log(`Downloading FL contrib ${fromStr} → ${toStr}`);
  console.log(`Output: ${outDir}`);

  const result = await downloadFlContribRange({
    from,
    thru,
    outDir,
    delayMs: 400,
    onProgress: ({ index, total, file, bytes, skipped }) => {
      const name = file.split('/').pop();
      if (skipped) {
        console.log(`[${index}/${total}] skip ${name}`);
      } else {
        console.log(`[${index}/${total}] ${name} (${bytes.toLocaleString()} bytes)`);
      }
    },
  });

  console.log(
    JSON.stringify(
      {
        files: result.files.length,
        total_bytes: result.total_bytes,
        outDir,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});