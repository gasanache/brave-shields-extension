import * as fs from 'fs';
import * as path from 'path';

/**
 * Converts ABP filter list rules to Chrome declarativeNetRequest (DNR) rules.
 *
 * This is a simplified converter that handles the most common ABP filter patterns.
 * For production use, consider using @nickerbudz/nickerbudz for more complete conversion.
 */

interface DnrRule {
  id: number;
  priority: number;
  action: {
    type: 'block' | 'allow' | 'redirect';
  };
  condition: {
    urlFilter?: string;
    regexFilter?: string;
    resourceTypes?: string[];
    domains?: string[];
    excludedDomains?: string[];
    domainType?: 'thirdParty' | 'firstParty';
    isUrlFilterCaseSensitive?: boolean;
  };
}

const LISTS_DIR = path.resolve(__dirname, '..', 'lists');
const RULESETS_DIR = path.resolve(__dirname, '..', 'rulesets');
const MAX_RULES_PER_RULESET = 5000;

const RESOURCE_TYPE_MAP: Record<string, string> = {
  script: 'script',
  image: 'image',
  stylesheet: 'stylesheet',
  object: 'object',
  xmlhttprequest: 'xmlhttprequest',
  'sub_frame': 'sub_frame',
  subdocument: 'sub_frame',
  font: 'font',
  media: 'media',
  websocket: 'websocket',
  ping: 'ping',
  other: 'other',
};

function parseAbpFilter(line: string, ruleId: number): DnrRule | null {
  line = line.trim();

  // Skip comments, empty lines, cosmetic rules, HTML lines
  if (!line || line.startsWith('!') || line.startsWith('[')) return null;
  if (line.startsWith('<') || line.startsWith('</')) return null; // HTML wrapper
  if (line.includes('##') || line.includes('#@#') || line.includes('#?#')) return null;
  if (line.includes('#$#') || line.includes('#@$#')) return null;

  let isException = false;
  if (line.startsWith('@@')) {
    isException = true;
    line = line.substring(2);
  }

  // Split filter and options
  const dollarIndex = line.lastIndexOf('$');
  let pattern = dollarIndex > 0 ? line.substring(0, dollarIndex) : line;
  const optionStr = dollarIndex > 0 ? line.substring(dollarIndex + 1) : '';

  const condition: DnrRule['condition'] = {};
  const options = optionStr ? optionStr.split(',') : [];

  // Skip rules with options that can't be correctly represented as DNR block rules
  const unsupportedOptions = ['replace', 'redirect', 'redirect-rule', 'csp', 'removeparam',
    'rewrite', 'badfilter', 'popunder', 'generichide', 'genericblock',
    'elemhide', 'ehide', 'specifichide', 'shide', 'inline-font', 'inline-script',
    'empty', 'mp4'];
  for (const opt of options) {
    const key = opt.split('=')[0];
    if (unsupportedOptions.includes(key)) return null;
  }

  let resourceTypes: string[] = [];
  let excludedResourceTypes: string[] = [];

  for (const opt of options) {
    const [key, value] = opt.split('=');

    if (key === 'domain' && value) {
      const domains: string[] = [];
      const excludedDomains: string[] = [];
      for (const d of value.split('|')) {
        if (d.startsWith('~')) {
          excludedDomains.push(d.substring(1));
        } else {
          domains.push(d);
        }
      }
      if (domains.length > 0) condition.domains = domains;
      if (excludedDomains.length > 0) condition.excludedDomains = excludedDomains;
    } else if (key === 'third-party') {
      condition.domainType = 'thirdParty';
    } else if (key === '~third-party') {
      condition.domainType = 'firstParty';
    } else if (key === 'match-case') {
      condition.isUrlFilterCaseSensitive = true;
    } else if (key.startsWith('~') && RESOURCE_TYPE_MAP[key.substring(1)]) {
      excludedResourceTypes.push(RESOURCE_TYPE_MAP[key.substring(1)]);
    } else if (RESOURCE_TYPE_MAP[key]) {
      resourceTypes.push(RESOURCE_TYPE_MAP[key]);
    }
  }

  // Default resource types for block rules — never block main_frame to avoid breaking navigation
  const NON_NAVIGATION_TYPES = [
    'sub_frame', 'stylesheet', 'script', 'image',
    'font', 'object', 'xmlhttprequest', 'ping', 'media', 'websocket', 'other',
  ];

  // Set resource types
  if (resourceTypes.length > 0) {
    // If explicitly includes main_frame on a block rule, remove it to prevent blocking navigation
    if (!isException) {
      resourceTypes = resourceTypes.filter((t) => t !== 'main_frame');
      if (resourceTypes.length === 0) return null; // Was main_frame-only, skip
    }
    condition.resourceTypes = resourceTypes;
  } else if (excludedResourceTypes.length > 0) {
    // If only exclusions, include all non-navigation types except excluded
    condition.resourceTypes = NON_NAVIGATION_TYPES.filter((t) => !excludedResourceTypes.includes(t));
  } else if (!isException) {
    // No resource types specified on a block rule — default to non-navigation types
    condition.resourceTypes = NON_NAVIGATION_TYPES;
  }

  // Convert pattern to urlFilter
  // ABP uses || for domain anchor, | for start/end anchor, ^ for separator, * for wildcard
  if (pattern.startsWith('/') && pattern.endsWith('/')) {
    // Regex filter — skip for now (limited budget)
    return null;
  }

  // Validate urlFilter for DNR compatibility
  // - Cannot have wildcard (*) immediately after domain anchor (||)
  // - Cannot be empty
  // - Cannot contain only special chars
  if (!pattern || pattern === '*' || pattern === '||') return null;
  if (pattern.startsWith('||*')) return null;
  if (pattern.startsWith('|*')) return null;
  // Remove trailing ^ if it's the only meaningful char left
  let cleanPattern = pattern;
  if (cleanPattern.endsWith('^') && cleanPattern.length > 1) {
    // Keep it — ^ is a valid separator placeholder in DNR
  }
  // Reject patterns that are just wildcards/anchors with no substance
  const stripped = cleanPattern.replace(/[|^*]/g, '');
  if (stripped.length === 0) return null;

  condition.urlFilter = cleanPattern;

  return {
    id: ruleId,
    priority: isException ? 2 : 1,
    action: { type: isException ? 'allow' : 'block' },
    condition,
  };
}

function convertList(listId: string): DnrRule[] {
  const listPath = path.join(LISTS_DIR, `${listId}.txt`);
  if (!fs.existsSync(listPath)) {
    console.warn(`List not found: ${listPath}`);
    return [];
  }

  const content = fs.readFileSync(listPath, 'utf-8');
  const lines = content.split('\n');
  const rules: DnrRule[] = [];
  let ruleId = 1;

  for (const line of lines) {
    if (rules.length >= MAX_RULES_PER_RULESET) break;

    const rule = parseAbpFilter(line, ruleId);
    if (rule) {
      rules.push(rule);
      ruleId++;
    }
  }

  return rules;
}

function main(): void {
  if (!fs.existsSync(RULESETS_DIR)) {
    fs.mkdirSync(RULESETS_DIR, { recursive: true });
  }

  const lists = ['easylist', 'easyprivacy', 'ublock-filters', 'peter-lowe'];

  for (const listId of lists) {
    console.log(`Converting ${listId}...`);
    const rules = convertList(listId);
    const outPath = path.join(RULESETS_DIR, `${listId}.json`);
    fs.writeFileSync(outPath, JSON.stringify(rules, null, 2));
    console.log(`  -> ${rules.length} rules written to ${listId}.json`);
  }

  console.log('\nDone.');
}

main();
