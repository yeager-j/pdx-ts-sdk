/** The ASCII lowercase snake_case grammar for mod identities and file stems. */
export const LOWERCASE_SNAKE_CASE = Object.freeze({
  pattern: /^[a-z][a-z0-9_]*$/,
  diagnostic: "lowercase snake_case ([a-z][a-z0-9_]*)",
});
