/** `npm run sources` — what is registered, and which parser handles it. */
import { loadCatalog } from './catalog.ts';
import { listParsers, getParser } from '../shared/parsers/index.ts';
import { loadEnv } from './env.ts';
import { missingEnv } from '../shared/parsers/registry.ts';

const env = loadEnv();
const catalog = loadCatalog();

console.log('PARSERS\n');
for (const p of listParsers()) {
  const missing = missingEnv(p, env);
  const status = missing.length ? `unavailable (needs ${missing.join(', ')})` : 'ready';
  const llm = p.usesLlm ? '  [LLM]' : '';
  console.log(`  ${p.platform.padEnd(12)} ${p.label.padEnd(22)} ${status}${llm}`);
  console.log(`  ${''.padEnd(12)} ${p.strategy}`);
}

console.log('\nSOURCES\n');
const byPlatform = new Map<string, typeof catalog>();
for (const s of catalog) {
  if (!byPlatform.has(s.platform)) byPlatform.set(s.platform, []);
  byPlatform.get(s.platform)!.push(s);
}

for (const [platform, sources] of [...byPlatform.entries()].sort()) {
  const active = sources.filter((s) => s.active).length;
  const def = getParser(platform);
  const note = def ? '' : '   << NO PARSER REGISTERED';
  console.log(`  ${platform}  (${active}/${sources.length} active)${note}`);
  for (const s of sources) {
    console.log(`      ${s.active ? '●' : '○'} ${s.name}`);
  }
}

const total = catalog.length;
const active = catalog.filter((s) => s.active).length;
console.log(`\n${active} active of ${total} registered, ${listParsers().length} parsers.`);
