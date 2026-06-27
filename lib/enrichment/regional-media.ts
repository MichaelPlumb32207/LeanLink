import { flCountyName } from '@/lib/fl-counties';

/** Regional news domains for site: queries, grouped by Florida region. */
const REGION_MEDIA: Record<string, string[]> = {
  panhandle: [
    'newsherald.com',
    'nwfdailynews.com',
    'pnj.com',
    'tallahassee.com',
    'waltonsun.com',
    'jacksoncountyfloridan.com',
  ],
  north_central: ['gainesville.com', 'alligator.org', 'ocala.com', 'dailycommercial.com'],
  northeast: ['staugustine.com', 'jacksonville.com', 'news4jax.com', 'palatkadailynews.com'],
  central: [
    'orlandosentinel.com',
    'orlandoweekly.com',
    'tampabay.com',
    'theledger.com',
    'news-journalonline.com',
  ],
  southwest: ['heraldtribune.com', 'naplesnews.com', 'news-press.com', 'floridatoday.com'],
  southeast: ['miamiherald.com', 'sun-sentinel.com', 'palmbeachpost.com', 'wptv.com'],
  keys: ['keysnews.com', 'flkeysnews.com'],
};

const COUNTY_REGION: Record<string, keyof typeof REGION_MEDIA> = {
  ESC: 'panhandle',
  OKA: 'panhandle',
  SAN: 'panhandle',
  WAL: 'panhandle',
  BAY: 'panhandle',
  CAL: 'panhandle',
  GAD: 'panhandle',
  GUL: 'panhandle',
  FRA: 'panhandle',
  WAK: 'panhandle',
  LIB: 'panhandle',
  JAC: 'panhandle',
  HOL: 'panhandle',
  WAS: 'panhandle',
  JEF: 'panhandle',
  MAD: 'panhandle',
  TAY: 'panhandle',
  DIX: 'panhandle',
  LEV: 'panhandle',
  SUW: 'panhandle',
  LAF: 'panhandle',
  UNI: 'panhandle',
  HAM: 'panhandle',
  ALA: 'north_central',
  GIL: 'north_central',
  COL: 'north_central',
  BRA: 'north_central',
  MR: 'north_central',
  MAR: 'north_central',
  PUT: 'north_central',
  DUV: 'northeast',
  NAS: 'northeast',
  STJ: 'northeast',
  CLA: 'northeast',
  FLA: 'northeast',
  VOL: 'northeast',
  BAK: 'northeast',
  LEO: 'panhandle',
  SEM: 'central',
  ORA: 'central',
  OSCE: 'central',
  LAKE: 'central',
  LAK: 'central',
  POL: 'central',
  SUM: 'central',
  HER: 'central',
  PAS: 'central',
  PIN: 'central',
  HIL: 'central',
  MAN: 'southwest',
  SAR: 'southwest',
  CHA: 'southwest',
  LEE: 'southwest',
  COLL: 'southwest',
  HEN: 'southwest',
  GLA: 'southwest',
  HIG: 'southwest',
  DES: 'southwest',
  HAR: 'southwest',
  CIT: 'southwest',
  BRE: 'southwest',
  IND: 'southeast',
  STL: 'southeast',
  MRT: 'southeast',
  PAL: 'southeast',
  BRO: 'southeast',
  DAD: 'southeast',
  MON: 'keys',
};

const FL_WIDE_MEDIA = [
  'tallahassee.com',
  'gainesville.com',
  'orlandosentinel.com',
  'tampabay.com',
  'miamiherald.com',
  'newsherald.com',
];

export function regionalMediaDomains(countyCode: string, limit = 4): string[] {
  const key = countyCode.trim().toUpperCase();
  const region = COUNTY_REGION[key];
  const regional = region ? REGION_MEDIA[region] : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const domain of [...regional, ...FL_WIDE_MEDIA]) {
    if (seen.has(domain)) continue;
    seen.add(domain);
    out.push(domain);
    if (out.length >= limit) break;
  }
  return out;
}

export function regionalMediaSiteClause(countyCode: string): string {
  const domains = regionalMediaDomains(countyCode, 4);
  return domains.map((d) => `site:${d}`).join(' OR ');
}

export function regionalMediaContextLabel(countyCode: string): string {
  const county = flCountyName(countyCode);
  const domains = regionalMediaDomains(countyCode, 3);
  return `${county} County area — try ${domains.join(', ')}`;
}