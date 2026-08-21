import type {
  CompanyParserContext,
  CompanyPlatform,
  CompanySourceMessage,
  RawCompany,
} from './types.ts';
import type { Env } from '../types.ts';

export type CompanyParseFn = (
  msg: CompanySourceMessage,
  ctx: CompanyParserContext,
) => Promise<RawCompany[]>;

export interface CompanyParserDef {
  platform: CompanyPlatform;
  label: string;
  strategy: string;
  requiresEnv?: Array<keyof Env>;
  parse: CompanyParseFn;
}

/** Thrown when a parser exists but cannot run — a missing key, not a bad source. */
export class UnavailableCompanyParserError extends Error {}

const registry = new Map<CompanyPlatform, CompanyParserDef>();

export function registerCompanyParser(def: CompanyParserDef): void {
  registry.set(def.platform, def);
}

export function getCompanyParser(platform: string): CompanyParserDef | undefined {
  return registry.get(platform as CompanyPlatform);
}

export function listCompanyParsers(): CompanyParserDef[] {
  return [...registry.values()];
}

export function missingCompanyEnv(def: CompanyParserDef, env: Env): string[] {
  return (def.requiresEnv ?? []).filter((k) => !env[k]).map(String);
}

export async function runCompanyParser(
  msg: CompanySourceMessage,
  ctx: CompanyParserContext,
): Promise<RawCompany[]> {
  const def = registry.get(msg.platform);
  if (!def) throw new Error(`no company parser registered for "${msg.platform}"`);

  const missing = missingCompanyEnv(def, ctx.env);
  if (missing.length) {
    throw new UnavailableCompanyParserError(`${def.label} needs ${missing.join(', ')}`);
  }

  const rows = await def.parse(msg, ctx);

  // Dedupe within a single source before it ever reaches Postgres: directories
  // list the same company on several pages, and collapsing here keeps the
  // payload (and the RPC's loop count) smaller.
  const seen = new Map<string, RawCompany>();
  for (const row of rows) {
    const key = row.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (key.length < 2) continue;
    const prior = seen.get(key);
    // Prefer the richer record when the same company shows up twice.
    if (!prior || score(row) > score(prior)) seen.set(key, row);
  }
  return [...seen.values()];
}

function score(c: RawCompany): number {
  return (
    (c.one_liner ? 2 : 0) +
    (c.description ? 2 : 0) +
    (c.website ? 1 : 0) +
    (c.hq_location ? 1 : 0) +
    (c.logo_url ? 1 : 0)
  );
}
