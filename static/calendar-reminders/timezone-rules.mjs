// Offset-only corrections from IANA tzdb 2026e. Runtime Intl remains the base
// database. These exact UTC instants are the final Zone transitions in the
// pinned northamerica/africa files, not dates inferred from news headlines.
// See TIMEZONE-SOURCES.md before updating this bounded compatibility layer.
export const TIME_ZONE_RULE_VERSION = '2026e';
export const TIME_ZONE_CORRECTIONS = Object.freeze({
  'America/Vancouver': {from: Date.parse('2026-11-01T09:00:00Z'), minutes: -420},
  'America/Edmonton': {from: Date.parse('2026-11-01T08:00:00Z'), minutes: -360},
  'America/Inuvik': {from: Date.parse('2026-11-01T08:00:00Z'), minutes: -360},
  'America/Winnipeg': {from: Date.parse('2026-11-01T07:00:00Z'), minutes: -300},
  'Africa/Casablanca': {from: Date.parse('2026-09-20T01:00:00Z'), minutes: 0},
  'Africa/El_Aaiun': {from: Date.parse('2026-09-20T01:00:00Z'), minutes: 0}
});
