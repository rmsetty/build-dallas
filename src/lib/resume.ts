/**
 * Client-side resume text extraction.
 *
 * PDF parsing runs in the browser on purpose: it keeps the resume out of our
 * Workers entirely, and pdf.js is the only dependency it needs. The extracted
 * text goes straight to public.apply_resume_text(), which does the keyword
 * matching in Postgres against the same vocabulary that tags events.
 */

export async function extractPdfText(file: File): Promise<string> {
  // Dynamic import: pdf.js touches DOM APIs, so it must not load during SSR.
  const pdfjs = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const task = pdfjs.getDocument({ data: await file.arrayBuffer() });
  const doc = await task.promise;
  const pages: string[] = [];

  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
    }
  } finally {
    await task.destroy();
  }

  return pages
    .join("\n\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/**
 * Best-effort school detection. Kept in the client rather than the keyword
 * table because school names are open-ended — the pattern catches the common
 * shapes and the local institutions we care about by name.
 */
const SCHOOL_PATTERNS: RegExp[] = [
  /\b(?:the\s+)?university\s+of\s+[A-Z][A-Za-z.'-]*(?:\s+(?:at|in)\s+[A-Z][A-Za-z.'-]*)?(?:\s+[A-Z][A-Za-z.'-]*)?/g,
  /\b[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+)*\s+(?:University|College|Institute of Technology)\b/g,
];

const KNOWN_SCHOOLS = [
  "Southern Methodist University",
  "University of Texas at Dallas",
  "University of Texas at Arlington",
  "University of North Texas",
  "Texas Christian University",
  "Texas A&M University",
  "Rice University",
  "Baylor University",
  "Texas Tech University",
  "UT Austin",
  "SMU",
  "UTD",
  "UTA",
  "UNT",
  "TCU",
];

export function detectSchool(text: string): string | null {
  for (const name of KNOWN_SCHOOLS) {
    const pattern = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (pattern.test(text)) return name;
  }

  for (const pattern of SCHOOL_PATTERNS) {
    const match = text.match(pattern);
    if (match?.[0]) return match[0].replace(/\s+/g, " ").trim();
  }
  return null;
}

/**
 * Which of the directory's companies show up in the resume. Matching happens on
 * a normalized form so "Acme, Inc." still hits "Acme Inc".
 */
export function matchCompanyNames(text: string, names: { id: string; name: string }[]) {
  const haystack = ` ${normalize(text)} `;
  return names.filter((c) => c.name.length >= 3 && haystack.includes(` ${normalize(c.name)} `));
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|corp|corporation|co)\b\.?/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
