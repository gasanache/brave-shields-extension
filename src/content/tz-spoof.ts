// MAIN-world, document_start. Reports U.S. Eastern time to the DISPLAY +
// DETECTION layer only: Intl.DateTimeFormat().resolvedOptions().timeZone (what
// modern timezone-detection libraries read — moment.tz.guess, dayjs, luxon) and
// Intl / Date#toLocale* formatting (so those render in ET). Registered only
// while BOTH "Force English (US)" and its "US time zone" sub-setting are on.
//
// It DELIBERATELY does NOT touch the raw Date object (getTimezoneOffset,
// getHours/getDate, setHours, toString, the numeric constructor). Those stay
// 100% native so a Date is internally consistent. Reason: patching only
// getTimezoneOffset while the component getters stay real makes moment/dayjs/
// date-fns serialize the WRONG instant (real wall-clock + spoofed offset),
// silently corrupting times written back to servers. Full Chromium-style
// emulation (patch every Date getter/setter/constructor to agree on ET) would
// avoid that, but any imperfection in a default-on, every-site injection would
// corrupt user data — not a trade worth making for a content-localization
// feature. Scope consequences (detection gaps, NOT breakage):
//   - Date.prototype.getTimezoneOffset() and Date.toString() report the REAL
//     zone (a fingerprint leak, and detectably inconsistent with Intl). Older
//     libs that sniff the zone via getTimezoneOffset (jstz) are not covered.
//   - Worker scopes (Worker/SharedWorker/ServiceWorker) get no content script,
//     so Intl/Date inside them see the real zone too.
// IP geolocation is likewise unchanged (needs a VPN).
(() => {
  'use strict';

  const TZ = 'America/New_York';
  const LOCALE = 'en-US';

  // Merge a default timeZone into an options argument WITHOUT losing inherited
  // or non-enumerable properties — the Intl spec reads options via [[Get]], so
  // a shallow {...options} spread would drop anything on the prototype chain.
  // Using the caller's object as the prototype preserves every property; we only
  // shadow timeZone, and only when the caller didn't already set one.
  const withTZ = (options: unknown): unknown => {
    if (options == null) return { timeZone: TZ };
    if (typeof options !== 'object') return options; // let the real method throw
    if ((options as { timeZone?: unknown }).timeZone != null) return options;
    return Object.assign(Object.create(options as object), { timeZone: TZ });
  };

  // Date.prototype.toLocale* — default locale + timeZone. Display-only (returns a
  // string); no instant math is touched, so no corruption is possible.
  const patchToLocale = (
    method: 'toLocaleString' | 'toLocaleDateString' | 'toLocaleTimeString'
  ): void => {
    const orig = Date.prototype[method];
    if (typeof orig !== 'function') return;
    try {
      Object.defineProperty(Date.prototype, method, {
        configurable: true,
        writable: true,
        value: function (this: Date, locales?: unknown, options?: unknown) {
          return (orig as any).call(this, locales ?? LOCALE, withTZ(options));
        },
      });
    } catch {
      // Leave the native method in place.
    }
  };
  patchToLocale('toLocaleString');
  patchToLocale('toLocaleDateString');
  patchToLocale('toLocaleTimeString');

  // Intl.DateTimeFormat — default timeZone (and locale) so resolvedOptions()
  // reports America/New_York and no-timeZone formatting renders in ET. An
  // explicit page-passed locale/timeZone is always respected. The Proxy
  // preserves .prototype / instanceof / statics / subclassing (via newTarget).
  // May compose with locale-spoof.ts's own DateTimeFormat proxy — both only
  // fill in omitted args, so double-wrapping in either order is idempotent.
  try {
    const Current = Intl.DateTimeFormat;
    Intl.DateTimeFormat = new Proxy(Current, {
      construct(target, args, newTarget) {
        return Reflect.construct(target, [args[0] ?? LOCALE, withTZ(args[1])], newTarget);
      },
      apply(target, thisArg, args) {
        return Reflect.apply(target, thisArg, [args[0] ?? LOCALE, withTZ(args[1])]);
      },
    }) as typeof Intl.DateTimeFormat;
  } catch {
    // Leave the native constructor in place.
  }
})();

export {};
