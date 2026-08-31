/** The ASCII lowercase snake_case grammar for mod identities and file stems. */
export const LOWERCASE_SNAKE_CASE = Object.freeze({
  pattern: /^[a-z][a-z0-9_]*$/,
  diagnostic: "lowercase snake_case ([a-z][a-z0-9_]*)",
});

/**
 * Matches the event ids a mod with this prefix mints: its bare prefix as a
 * namespace, or one of its `<prefix>_*` namespaces, followed by the event
 * number.
 *
 * The namespace has to end at a `_`-delimited segment boundary, so a foreign
 * namespace that merely begins with the prefix — `pp_module_extras` against
 * prefix `pp_mod` — is somebody else's and does not match.
 */
export function ownEventIdPattern(prefix: string): RegExp {
  return new RegExp(`^${prefix}(_[a-z0-9_]*)?\\.\\d+$`);
}
