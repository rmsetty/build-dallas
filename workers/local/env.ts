import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { Env } from '../shared/types.ts';

const here = dirname(fileURLToPath(import.meta.url));
export const WORKERS_ROOT = resolve(here, '..');
export const REPO_ROOT = resolve(here, '../..');

/**
 * Reads workers/.dev.vars (the same file `wrangler dev` uses) so local runs and
 * Worker runs are configured identically. process.env wins, so you can do
 * `SUPABASE_URL=... npm run pipeline` for a one-off.
 */
export function loadEnv(): Env {
  const vars: Record<string, string> = {};
  const devVars = resolve(WORKERS_ROOT, '.dev.vars');

  if (existsSync(devVars)) {
    for (const line of readFileSync(devVars, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 0) continue;
      vars[trimmed.slice(0, eq).trim()] = trimmed
        .slice(eq + 1)
        .trim()
        .replace(/^["']|["']$/g, '');
    }
  }

  const get = (key: string) => process.env[key] ?? vars[key];

  return {
    SUPABASE_URL: get('SUPABASE_URL') ?? '',
    SUPABASE_SERVICE_ROLE_KEY: get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    GROQ_API_KEY: get('GROQ_API_KEY'),
    GROQ_MODEL: get('GROQ_MODEL'),
    TRIGGER_SECRET: get('TRIGGER_SECRET'),
  };
}

export function hasDatabase(env: Env): boolean {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
}
