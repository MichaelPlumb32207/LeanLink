export type SortColumn = 'name' | 'lean' | 'confidence' | 'turnout' | 'primary' | 'opposition';

export type SortDirection = 'asc' | 'desc';

export interface ColumnFilters {
  name: string;
  lean: string;
  confidenceMin: string;
  confidenceMax: string;
  turnout: string;
  primary: string;
  oppositionMin: string;
  oppositionMax: string;
}

export const EMPTY_COLUMN_FILTERS: ColumnFilters = {
  name: '',
  lean: '',
  confidenceMin: '',
  confidenceMax: '',
  turnout: '',
  primary: '',
  oppositionMin: '',
  oppositionMax: '',
};

export const TURNOUT_RANK: Record<string, number> = { High: 3, Medium: 2, Low: 1 };

export interface LeanResultRow {
  voter_hash: string;
  lean: string;
  confidence: number;
  turnout_propensity?: string;
  turnout_score?: number;
  primary_engagement?: string;
  opposition_mobilization_score?: number;
  evidence: string[];
  raw_data?: { name?: { full?: string }; residence?: { city?: string } };
}

export function hasActiveFilters(filters: ColumnFilters): boolean {
  return Object.values(filters).some((v) => v.trim() !== '');
}

export function buildResultsQueryString(options: {
  sortColumn: SortColumn;
  sortDirection: SortDirection;
  filters: ColumnFilters;
  limit?: number;
}): string {
  const params = new URLSearchParams();
  params.set('sort', options.sortColumn);
  params.set('order', options.sortDirection);
  if (options.limit) params.set('limit', String(options.limit));

  if (options.filters.name.trim()) params.set('name', options.filters.name.trim());
  if (options.filters.lean) params.set('lean', options.filters.lean);
  if (options.filters.confidenceMin) params.set('confidenceMin', options.filters.confidenceMin);
  if (options.filters.confidenceMax) params.set('confidenceMax', options.filters.confidenceMax);
  if (options.filters.turnout) params.set('turnout', options.filters.turnout);
  if (options.filters.primary.trim()) params.set('primary', options.filters.primary.trim());
  if (options.filters.oppositionMin) params.set('oppositionMin', options.filters.oppositionMin);
  if (options.filters.oppositionMax) params.set('oppositionMax', options.filters.oppositionMax);

  return params.toString();
}

function compareValues(
  a: string | number | undefined,
  b: string | number | undefined,
  direction: SortDirection,
): number {
  const av = a ?? '';
  const bv = b ?? '';
  let cmp = 0;
  if (typeof av === 'number' && typeof bv === 'number') {
    cmp = av - bv;
  } else {
    cmp = String(av).localeCompare(String(bv));
  }
  return direction === 'asc' ? cmp : -cmp;
}

function getSortValue(row: LeanResultRow, column: SortColumn): string | number {
  switch (column) {
    case 'name':
      return row.raw_data?.name?.full ?? '';
    case 'lean':
      return row.lean;
    case 'confidence':
      return row.confidence;
    case 'turnout':
      return TURNOUT_RANK[row.turnout_propensity ?? ''] ?? row.turnout_score ?? 0;
    case 'primary':
      return row.primary_engagement ?? '';
    case 'opposition':
      return row.opposition_mobilization_score ?? 0;
    default:
      return '';
  }
}

export function applyClientFilters(rows: LeanResultRow[], filters: ColumnFilters): LeanResultRow[] {
  return rows.filter((row) => {
    const name = row.raw_data?.name?.full ?? '';
    if (filters.name && !name.toLowerCase().includes(filters.name.toLowerCase())) return false;
    if (filters.lean && row.lean !== filters.lean) return false;
    if (filters.confidenceMin && row.confidence < Number(filters.confidenceMin)) return false;
    if (filters.confidenceMax && row.confidence > Number(filters.confidenceMax)) return false;
    if (filters.turnout && row.turnout_propensity !== filters.turnout) return false;
    if (
      filters.primary &&
      !(row.primary_engagement ?? '').toLowerCase().includes(filters.primary.toLowerCase())
    ) {
      return false;
    }
    const opp = row.opposition_mobilization_score ?? 0;
    if (filters.oppositionMin && opp < Number(filters.oppositionMin)) return false;
    if (filters.oppositionMax && opp > Number(filters.oppositionMax)) return false;
    return true;
  });
}

export function sortResultRows(
  rows: LeanResultRow[],
  column: SortColumn,
  direction: SortDirection,
): LeanResultRow[] {
  return [...rows].sort((a, b) => compareValues(getSortValue(a, column), getSortValue(b, column), direction));
}

export function shouldUseServerSort(uploadRowCount: number): boolean {
  return uploadRowCount > 1000;
}

export function shouldUseServerQuery(uploadRowCount: number, filters: ColumnFilters): boolean {
  return shouldUseServerSort(uploadRowCount) || hasActiveFilters(filters);
}

const SORT_COLUMNS: SortColumn[] = ['name', 'lean', 'confidence', 'turnout', 'primary', 'opposition'];

export function parseSortColumn(value: string | null): SortColumn {
  if (value && SORT_COLUMNS.includes(value as SortColumn)) return value as SortColumn;
  return 'opposition';
}

export function parseSortDirection(value: string | null): SortDirection {
  return value === 'asc' ? 'asc' : 'desc';
}

export function parseColumnFilters(searchParams: URLSearchParams): ColumnFilters {
  return {
    name: searchParams.get('name') ?? '',
    lean: searchParams.get('lean') ?? '',
    confidenceMin: searchParams.get('confidenceMin') ?? '',
    confidenceMax: searchParams.get('confidenceMax') ?? '',
    turnout: searchParams.get('turnout') ?? '',
    primary: searchParams.get('primary') ?? '',
    oppositionMin: searchParams.get('oppositionMin') ?? '',
    oppositionMax: searchParams.get('oppositionMax') ?? '',
  };
}

export interface ResultsSqlQuery {
  whereSql: string;
  orderSql: string;
  params: unknown[];
  limit: number;
}

export function buildResultsSql(options: {
  uploadId: string;
  userEmail: string;
  sortColumn: SortColumn;
  sortDirection: SortDirection;
  filters: ColumnFilters;
  limit: number;
}): ResultsSqlQuery {
  const params: unknown[] = [options.uploadId, options.userEmail];
  const conditions = ['r.upload_id = $1', 'r.user_id = $2'];

  if (options.filters.name.trim()) {
    params.push(`%${options.filters.name.trim()}%`);
    conditions.push(`vr.raw_data->'name'->>'full' ILIKE $${params.length}`);
  }
  if (options.filters.lean) {
    params.push(options.filters.lean);
    conditions.push(`r.lean = $${params.length}`);
  }
  if (options.filters.confidenceMin) {
    params.push(Number(options.filters.confidenceMin));
    conditions.push(`r.confidence >= $${params.length}`);
  }
  if (options.filters.confidenceMax) {
    params.push(Number(options.filters.confidenceMax));
    conditions.push(`r.confidence <= $${params.length}`);
  }
  if (options.filters.turnout) {
    params.push(options.filters.turnout);
    conditions.push(`r.turnout_propensity = $${params.length}`);
  }
  if (options.filters.primary.trim()) {
    params.push(`%${options.filters.primary.trim()}%`);
    conditions.push(`r.primary_engagement ILIKE $${params.length}`);
  }
  if (options.filters.oppositionMin) {
    params.push(Number(options.filters.oppositionMin));
    conditions.push(`r.opposition_mobilization_score >= $${params.length}`);
  }
  if (options.filters.oppositionMax) {
    params.push(Number(options.filters.oppositionMax));
    conditions.push(`r.opposition_mobilization_score <= $${params.length}`);
  }

  const dir = options.sortDirection === 'asc' ? 'ASC' : 'DESC';
  const nulls = options.sortDirection === 'asc' ? 'NULLS FIRST' : 'NULLS LAST';

  let orderExpr: string;
  switch (options.sortColumn) {
    case 'name':
      orderExpr = `vr.raw_data->'name'->>'full' ${dir} ${nulls}`;
      break;
    case 'lean':
      orderExpr = `r.lean ${dir}`;
      break;
    case 'confidence':
      orderExpr = `r.confidence ${dir} ${nulls}`;
      break;
    case 'turnout':
      orderExpr = `CASE r.turnout_propensity WHEN 'High' THEN 3 WHEN 'Medium' THEN 2 WHEN 'Low' THEN 1 ELSE 0 END ${dir}, r.turnout_score ${dir} ${nulls}`;
      break;
    case 'primary':
      orderExpr = `r.primary_engagement ${dir} ${nulls}`;
      break;
    case 'opposition':
    default:
      orderExpr = `r.opposition_mobilization_score ${dir} ${nulls}`;
      break;
  }

  const limit = Math.min(Math.max(options.limit, 1), 10000);

  return {
    whereSql: conditions.join(' AND '),
    orderSql: orderExpr,
    params,
    limit,
  };
}

export const SORT_COLUMN_LABELS: Record<SortColumn, string> = {
  name: 'Name',
  lean: 'Lean',
  confidence: 'Confidence',
  turnout: 'Turnout',
  primary: 'Primary',
  opposition: 'Opposition score',
};