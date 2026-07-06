// MAIN-world, document_start. Forces the JS-visible locale to U.S. English so
// client-side i18n code serves the English variant, complementing the
// Accept-Language request header set via declarativeNetRequest and the
// Google/YouTube PREF cookie. Registered and unregistered dynamically based on
// the global "Force English (US)" setting (see src/background/locale-spoof.ts).
// Runs before any page script. Timezone spoofing lives in tz-spoof.ts (its own
// sub-setting) — this file is language-only.
(() => {
  'use strict';

  const LANGUAGE = 'en-US';
  const LANGUAGES = Object.freeze(['en-US', 'en']);

  // --- navigator.language / navigator.languages ----------------------------
  // Override the getters on Navigator.prototype (navigator has no own copies of
  // these props, so redefining the prototype getter changes what the page reads).
  const override = (prop: string, getter: () => unknown): void => {
    try {
      Object.defineProperty(Navigator.prototype, prop, {
        configurable: true,
        enumerable: true,
        get: getter,
      });
    } catch {
      // Some environments mark these non-configurable — nothing we can do.
    }
  };

  override('language', () => LANGUAGE);
  override('languages', () => LANGUAGES);

  // --- Intl default locale --------------------------------------------------
  // Code that constructs Intl objects WITHOUT a locale gets the browser's real
  // default — i18n libraries commonly sniff it via
  // Intl.DateTimeFormat().resolvedOptions().locale. Force the default to en-US.
  // An explicit locale passed by the page is respected: it's the site's own
  // deliberate choice, and it's usually derived from navigator.language anyway,
  // which we already spoof. The Proxy preserves .prototype / instanceof /
  // supportedLocalesOf and subclassing (via newTarget).
  const INTL_CTORS = [
    'DateTimeFormat',
    'NumberFormat',
    'Collator',
    'PluralRules',
    'RelativeTimeFormat',
    'ListFormat',
    'Segmenter',
    'DisplayNames', // region/language/currency label localization
    'DurationFormat', // newer engines only; skipped if absent
  ];
  const defaultLocaleArgs = (args: unknown[]): unknown[] =>
    args[0] == null ? [LANGUAGE, ...args.slice(1)] : args;

  for (const name of INTL_CTORS) {
    const Real = (Intl as Record<string, any>)[name];
    if (typeof Real !== 'function') continue;
    try {
      (Intl as Record<string, any>)[name] = new Proxy(Real, {
        construct(target, args, newTarget) {
          return Reflect.construct(target, defaultLocaleArgs(args), newTarget);
        },
        apply(target, thisArg, args) {
          return Reflect.apply(target, thisArg, defaultLocaleArgs(args));
        },
      });
    } catch {
      // Leave the real constructor in place.
    }
  }

  // --- toLocale* default locale ----------------------------------------------
  // Same story for the prototype helpers: no-locale calls use the real default.
  // Only the locales argument is defaulted; options pass through untouched.
  const wrapLocaleDefault = (proto: object, method: string): void => {
    const orig = (proto as Record<string, any>)[method];
    if (typeof orig !== 'function') return;
    try {
      Object.defineProperty(proto, method, {
        configurable: true,
        writable: true,
        value: function (this: unknown, locales?: unknown, ...rest: unknown[]) {
          return orig.call(this, locales ?? LANGUAGE, ...rest);
        },
      });
    } catch {
      // Leave the real method in place.
    }
  };

  wrapLocaleDefault(Number.prototype, 'toLocaleString');
  wrapLocaleDefault(BigInt.prototype, 'toLocaleString');
  wrapLocaleDefault(Date.prototype, 'toLocaleString');
  wrapLocaleDefault(Date.prototype, 'toLocaleDateString');
  wrapLocaleDefault(Date.prototype, 'toLocaleTimeString');
})();

export {};
