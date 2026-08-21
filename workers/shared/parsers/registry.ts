import type { Env, RawEvent, SourceMessage } from '../types.ts';

export interface ParserContext {
  env: Env;
  log: (message: string) => void;
}

export type ParseFn = (source: SourceMessage, ctx: ParserContext) => Promise<RawEvent[]>;

export interface ParserDef {
  /** Matches sources.platform. Must also exist as a row in public.platforms. */
  platform: string;
  label: string;
  /** Short note on where the data comes from, shown by `npm run sources`. */
  strategy: string;
  /** True if this parser sends page content to an LLM. */
  usesLlm?: boolean;
  /** Env vars that must be set, else the parser is reported unavailable. */
  requiresEnv?: Array<keyof Env>;
  parse: ParseFn;
}

const registry = new Map<string, ParserDef>();

/**
 * Adding a source type is: write one file exporting a ParseFn, call
 * registerParser once in parsers/index.ts, and insert a row in
 * public.platforms. Nothing else in the pipeline changes — the consumer, the
 * local runner and the failure handling all go through this registry.
 */
export function registerParser(def: ParserDef): void {
  if (registry.has(def.platform)) {
    throw new Error(`duplicate parser registration for platform "${def.platform}"`);
  }
  registry.set(def.platform, def);
}

export function getParser(platform: string): ParserDef | undefined {
  return registry.get(platform);
}

export function listParsers(): ParserDef[] {
  return [...registry.values()].sort((a, b) => a.platform.localeCompare(b.platform));
}

/** Missing credentials make a parser unavailable, not broken. */
export function missingEnv(def: ParserDef, env: Env): string[] {
  return (def.requiresEnv ?? []).filter((key) => !env[key]).map(String);
}

export class UnavailableParserError extends Error {}

export async function runParser(source: SourceMessage, ctx: ParserContext): Promise<RawEvent[]> {
  const def = getParser(source.platform);
  if (!def) {
    throw new UnavailableParserError(
      `no parser registered for platform "${source.platform}" ` +
        `(registered: ${listParsers().map((p) => p.platform).join(', ')})`,
    );
  }

  const missing = missingEnv(def, ctx.env);
  if (missing.length) {
    throw new UnavailableParserError(`${def.platform} needs ${missing.join(', ')}`);
  }

  return def.parse(source, ctx);
}
