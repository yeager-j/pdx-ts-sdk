/**
 * Proves a union was handled completely.
 *
 * Every caller passes a value the compiler has narrowed to `never`, so adding a
 * variant to a generated vocabulary fails `npm run typecheck` at each
 * interpreter that does not handle it. Reaching this at runtime means the
 * generated data carries a variant its type does not declare.
 *
 * @param value The narrowed value; `never` when the switch above is exhaustive.
 * @param what What was being interpreted, named for the error message.
 */
export function assertNever(value: never, what: string): never {
  throw new Error(`${what}: unhandled variant ${JSON.stringify(value)}`);
}
