import type { BallotFavors } from '@/lib/fl-voter-history';

export const BALLOT_FAVORS_OPTIONS: {
  value: BallotFavors;
  label: string;
  description: string;
}[] = [
  {
    value: 'south',
    label: 'Favors Right',
    description: 'Opposition mobilization assumes outreach leans conservative (Right).',
  },
  {
    value: 'north',
    label: 'Favors Left',
    description: 'Opposition mobilization assumes outreach leans progressive (Left).',
  },
];

export function ballotFavorsLabel(value: string | null | undefined): string {
  const opt = BALLOT_FAVORS_OPTIONS.find((o) => o.value === value);
  return opt?.label ?? value ?? '—';
}