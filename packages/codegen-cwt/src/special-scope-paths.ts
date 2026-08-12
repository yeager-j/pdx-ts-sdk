/**
 * Scope paths whose meaning depends on the evaluation context rather than a
 * declared source/target scope pair.
 *
 * Both rule reconciliation and vanilla scripted-definition inference must
 * treat these as navigation, never as evidence of definition legality.
 */
export const SPECIAL_SCOPE_PATHS = new Set([
  "root",
  "this",
  "from",
  "fromfrom",
  "fromfromfrom",
  "fromfromfromfrom",
  "prev",
  "prevprev",
  "prevprevprev",
  "prevprevprevprev",
]);
