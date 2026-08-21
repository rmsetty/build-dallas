/**
 * Company parser registrations. Same contract as the event registry: add a file,
 * add one block here, insert a row in public.platforms, done.
 */
import { registerCompanyParser } from './registry.ts';
import { fetchJsonLdOrgs } from './jsonldOrg.ts';
import { fetchSecFormD } from './secFormD.ts';
import { fetchSquarespaceGallery } from './squarespaceGallery.ts';
import { fetchYcDirectory } from './ycDirectory.ts';

registerCompanyParser({
  platform: 'sec_form_d',
  label: 'SEC Form D',
  strategy: 'EDGAR full-text search, Form D filings by DFW-domiciled issuers',
  parse: fetchSecFormD,
});

registerCompanyParser({
  platform: 'jsonld_org',
  label: 'schema.org Organization',
  strategy: 'ld+json and Next.js flight payloads on portfolio pages',
  parse: fetchJsonLdOrgs,
});

registerCompanyParser({
  platform: 'yc_directory',
  label: 'Y Combinator directory',
  strategy: 'yc-oss static JSON mirror, filtered by location',
  parse: fetchYcDirectory,
});

registerCompanyParser({
  platform: 'sqsp_gallery',
  label: 'Squarespace logo gallery',
  strategy: 'company names recovered from gallery image alt text',
  parse: fetchSquarespaceGallery,
});

export {
  getCompanyParser,
  listCompanyParsers,
  missingCompanyEnv,
  registerCompanyParser,
  runCompanyParser,
  UnavailableCompanyParserError,
} from './registry.ts';
export type { CompanyParserDef, CompanyParseFn } from './registry.ts';
