/**
 * Import FL DOS campaign finance tab-delimited export into reference index.
 *
 * Usage:
 *   npx tsx scripts/import-fl-contrib-tsv.ts --file /path/to/Contrib.txt --label 2026q2-full
 */
import { importFlContribTsv } from '@/lib/reference-data/import-fl-contrib';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const file = arg('--file');
  const label = arg('--label');
  if (!file || !label) {
    console.error('Usage: npx tsx scripts/import-fl-contrib-tsv.ts --file PATH --label NAME');
    process.exit(1);
  }

  const result = await importFlContribTsv({
    filePath: file,
    label,
    dateFrom: arg('--from'),
    dateTo: arg('--to'),
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});