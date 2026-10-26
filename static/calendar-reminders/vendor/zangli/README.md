# 藏历 PRO vendored dependency

Upstream: https://github.com/stonelf/zangli
Pinned commit: `c29e60f8292473c038a1da7d5a4061a3c97026fa`
Package version: `0.2.0`
License: MIT, see LICENSE.md.

The three .mjs files preserve the upstream UMD implementation with a small ESM import/export adapter. No dependency is loaded from a CDN. The app uses getZangli only for Tibetan calendar conversion; it does not use upstream festival labels or extrapolate ceremonies or astronomical events. Names and published observances are supplied by 佛慧法语.

Upstream source locations:
- zangli.js
- wxapp/zangli/data/special-days.js
- wxapp/zangli/data/eclipse-list.js

Calendar range: 1951-01-08 through 2051-02-11. Eclipse data is retained as a dependency of the original UMD factory; it is not used to publish events.

