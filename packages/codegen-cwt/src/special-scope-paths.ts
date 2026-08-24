/**
 * Named ambient scope slots in their generated API and fingerprint order.
 *
 * `this` is deliberately absent: it is the block's direct scope rather than
 * a declared ambient slot.
 */
export const AMBIENT_SCOPE_KEYS = [
  "root",
  "from",
  "fromfrom",
  "fromfromfrom",
  "fromfromfromfrom",
  "prev",
  "prevprev",
  "prevprevprev",
  "prevprevprevprev",
] as const;

/** One named ambient scope slot. */
export type AmbientScopeKey = (typeof AMBIENT_SCOPE_KEYS)[number];

/**
 * Scope paths whose meaning depends on the evaluation context rather than a
 * declared source/target scope pair.
 *
 * Both rule reconciliation and vanilla scripted-definition inference must
 * treat these as navigation, never as evidence of definition legality.
 */
export const SPECIAL_SCOPE_PATHS = new Set(["this", ...AMBIENT_SCOPE_KEYS]);
