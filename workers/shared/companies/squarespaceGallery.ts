import { decodeEntities, BROWSER_HEADERS } from '../http.ts';
import type { CompanyParserContext, CompanySourceMessage, RawCompany } from './types.ts';

/**
 * Squarespace gallery-block portfolios.
 *
 * Several Dallas accelerators publish their portfolio as a wall of logos with
 * no text at all — Health Wildcatters is the notable one. The only company name
 * on the page is the uploaded image's filename, surfaced in the alt attribute
 * ("HarmonIQ Biosciences Logo - Mario Sierra (1).png"). Recovering a name from
 * that is unglamorous but it is the difference between having those companies
 * and not having them.
 *
 * Deliberately conservative: anything that does not clean up into a plausible
 * name is dropped rather than guessed at.
 */
const NOISE =
  /\b(logo|logos|final|fin|current|transparent|copy|new|old|updated|version|full|color|colour|white|black|dark|light|bg|background|removebg|preview|artboard|png|jpg|jpeg|svg|webp|horizontal|vertical|stacked|square|primary|secondary|large|small|hi ?res|lo ?res|rgb|cmyk|thumbnail|header|banner|icon|mark|wordmark|with title|no title|untitled|screenshot|screen shot|image|unsplash|photo|img|dsc|v\\d+)\b/gi;

/** Filenames the CMS generated rather than a human: screenshots, exports. */
const MACHINE_NAME = /^\d{4}[-/.]\d{1,2}|\bat \d{1,2}[.:]\d{2}|^(img|dsc|image|screen ?shot|untitled)\b/i;

export async function fetchSquarespaceGallery(
  msg: CompanySourceMessage,
  ctx: CompanyParserContext,
): Promise<RawCompany[]> {
  const res = await fetch(msg.url, { headers: BROWSER_HEADERS });
  if (!res.ok) throw new Error(`GET ${msg.url} -> ${res.status}`);
  const html = await res.text();

  const s = msg.scrape_strategy;
  const exclude = new Set((s.exclude_names ?? []).map((n) => n.toLowerCase()));
  const label = s.signal_label ?? 'Accelerator portfolio';
  const found = new Map<string, RawCompany>();

  // Only <img> tags carrying the gallery's thumb-image class: the page's own
  // chrome (nav logo, hero photo) uses different classes and would otherwise
  // arrive as companies.
  for (const m of html.matchAll(/<img[^>]*\bclass="[^"]*thumb-image[^"]*"[^>]*>/gi)) {
    const tag = m[0];
    const alt = /\salt="([^"]*)"/i.exec(tag)?.[1];
    const src = /\sdata-image="([^"]*)"/i.exec(tag)?.[1] ?? /\sdata-src="([^"]*)"/i.exec(tag)?.[1];

    const name = cleanFilename(decodeEntities(alt));
    if (!name || exclude.has(name.toLowerCase())) continue;

    const key = name.toLowerCase();
    if (found.has(key)) continue;

    found.set(key, {
      name,
      hq_location: s.default_location ?? (s.dfw_only ? 'Dallas–Fort Worth, TX' : null),
      logo_url: src ?? null,
      signal: s.signal ?? 'accelerator',
      signal_detail: label,
    });
  }

  ctx.log(`${found.size} companies recovered from gallery alt text`);
  return [...found.values()];
}

/** "HarmonIQ Biosciences Logo - Mario Sierra (1).png" -> "HarmonIQ Biosciences" */
function cleanFilename(raw: string | null): string | null {
  if (!raw) return null;
  let v = raw;

  v = v.replace(/\.(png|jpe?g|svg|webp|gif|avif)$/i, '');
  // Squarespace URL-encodes spaces in uploaded filenames.
  v = v.replace(/[_+]+/g, ' ');
  // "Logo - Mario Sierra" is the uploader's name appended by the CMS.
  v = v.split(/\s+[-–—]\s+/)[0] ?? v;
  v = v.replace(/\(\s*\d+\s*\)/g, ' ');

  if (MACHINE_NAME.test(v.trim())) return null;

  // Designers glue the qualifier straight onto the name ("NearwaveLogo",
  // "FullLogo.v2"), so the word-boundary pass below would never see it.
  v = v.replace(/([a-z0-9])(Logo|Logos|Icon|Mark|Final|Full)\b/g, '$1');
  v = v.replace(NOISE, ' ');
  v = v.replace(/[^A-Za-z0-9&'’.\- ]+/g, ' ');
  v = v.replace(/\s+/g, ' ').trim();
  v = v.replace(/^[-–—.\s]+|[-–—.\s]+$/g, '');
  // Strip a version/year tail, but never a bare trailing digit: "Cloud 9" and
  // "20over8" are the actual company names.
  v = v.replace(/([.\-]\s*\d{1,4}|\s+(?:19|20)\d{2})$/, '').trim();

  // A stray photo filename ("ryan duffy bk7ci4ohi6w unsplash") survives the
  // steps above as a long lowercase run, so require a real name shape.
  if (v.length < 2 || v.length > 60) return null;
  if (!/[A-Za-z]/.test(v)) return null;
  if (!/^[A-Z0-9]/.test(v)) return null;
  if (v.split(/\s+/).length > 5) return null;

  return v;
}
