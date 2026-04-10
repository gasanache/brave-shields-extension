import * as fs from 'fs';
import * as path from 'path';

/**
 * Extracts cosmetic filter rules from ABP filter lists and generates CSS files.
 *
 * Cosmetic rules use ## syntax: domain##selector
 * Generic rules (no domain): ##selector
 */

const LISTS_DIR = path.resolve(__dirname, '..', 'lists');
const COSMETIC_DIR = path.resolve(__dirname, '..', 'cosmetic');
const SPECIFIC_DIR = path.join(COSMETIC_DIR, 'specific');

interface CosmeticRule {
  domains: string[];
  excludedDomains: string[];
  selector: string;
  isGeneric: boolean;
}

function parseCosmeticRule(line: string): CosmeticRule | null {
  line = line.trim();
  if (!line || line.startsWith('!') || line.startsWith('[')) return null;

  // Element hiding: ##selector or domain##selector
  let separatorIndex = line.indexOf('##');
  let isException = false;

  if (separatorIndex === -1) {
    // Check for exception: #@#
    separatorIndex = line.indexOf('#@#');
    if (separatorIndex === -1) return null;
    isException = true;
  }

  // Skip extended selectors (#?#, #$#, etc.)
  if (line.includes('#?#') || line.includes('#$#') || line.includes('#@$#')) return null;

  const domainPart = line.substring(0, separatorIndex);
  const selector = line.substring(separatorIndex + (isException ? 3 : 2)).trim();

  if (!selector) return null;
  if (isException) return null; // Skip exception rules for simplicity

  // Parse domains
  const domains: string[] = [];
  const excludedDomains: string[] = [];

  if (domainPart) {
    for (const d of domainPart.split(',')) {
      const domain = d.trim();
      if (domain.startsWith('~')) {
        excludedDomains.push(domain.substring(1));
      } else {
        domains.push(domain);
      }
    }
  }

  return {
    domains,
    excludedDomains,
    selector,
    isGeneric: domains.length === 0 && excludedDomains.length === 0,
  };
}

function main(): void {
  if (!fs.existsSync(COSMETIC_DIR)) {
    fs.mkdirSync(COSMETIC_DIR, { recursive: true });
  }
  if (!fs.existsSync(SPECIFIC_DIR)) {
    fs.mkdirSync(SPECIFIC_DIR, { recursive: true });
  }

  const lists = ['easylist', 'easyprivacy', 'ublock-filters', 'peter-lowe', 'ublock-privacy'];
  const genericSelectors = new Set<string>();
  const domainSelectors = new Map<string, Set<string>>();

  for (const listId of lists) {
    const listPath = path.join(LISTS_DIR, `${listId}.txt`);
    if (!fs.existsSync(listPath)) {
      console.warn(`List not found: ${listPath}`);
      continue;
    }

    const content = fs.readFileSync(listPath, 'utf-8');
    const lines = content.split('\n');
    let cosmeticCount = 0;

    for (const line of lines) {
      const rule = parseCosmeticRule(line);
      if (!rule) continue;

      cosmeticCount++;

      if (rule.isGeneric) {
        genericSelectors.add(rule.selector);
      } else {
        for (const domain of rule.domains) {
          if (!domainSelectors.has(domain)) {
            domainSelectors.set(domain, new Set());
          }
          domainSelectors.get(domain)!.add(rule.selector);
        }
      }
    }

    console.log(`${listId}: ${cosmeticCount} cosmetic rules`);
  }

  // Write generic CSS (limit to reasonable size)
  const genericArr = [...genericSelectors];
  const MAX_GENERIC = 2000;
  const genericCss = genericArr
    .slice(0, MAX_GENERIC)
    .map((s) => `${s} { display: none !important; }`)
    .join('\n');
  fs.writeFileSync(path.join(COSMETIC_DIR, 'generic.css'), genericCss);
  console.log(`\nGeneric selectors: ${genericArr.length} (using ${Math.min(genericArr.length, MAX_GENERIC)})`);

  // Write per-domain CSS files (top domains by rule count)
  const sortedDomains = [...domainSelectors.entries()]
    .sort((a, b) => b[1].size - a[1].size);

  let domainFilesWritten = 0;
  for (const [domain, selectors] of sortedDomains) {
    if (selectors.size < 2) continue; // Skip domains with very few rules

    const css = [...selectors]
      .map((s) => `${s} { display: none !important; }`)
      .join('\n');
    fs.writeFileSync(path.join(SPECIFIC_DIR, `${domain}.css`), css);
    domainFilesWritten++;
  }

  console.log(`Domain-specific CSS files: ${domainFilesWritten}`);
  console.log('\nDone.');
}

main();
