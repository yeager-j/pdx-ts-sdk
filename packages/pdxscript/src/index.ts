/**
 * The public surface of `@pdx-ts/pdxscript`: a parser and serializer for the
 * Clausewitz script format, with no game semantics in it.
 *
 * Four groups. `parse` and `serialize` are the ends. The AST types and their
 * constructors are what sits between them, and every constructor refuses what
 * the parser could not have produced, so a hand-built tree is in the same
 * language as a parsed one. The `is*` predicates and the numeral helpers are
 * that same set of rules, exposed for callers who need to ask before building.
 * `walkItems` and `regionItems` are for reading a tree back.
 *
 * See GRAMMAR.md for the language and the repair policy.
 */

export * from "./ast.ts";
export { PdxSyntaxError } from "./lexer.ts";
export {
  canonicalNumeral,
  classifyUnquoted,
  decimalLexeme,
  isBareKey,
  isBareString,
  isBareToken,
  isMathSource,
  isNumeral,
  isOperator,
  isParamName,
  isQuotableContent,
  isVarName,
  isWritableText,
  MAX_NESTING_DEPTH,
  numberValue,
  PDX_OPERATORS,
  tryNumberValue,
} from "./representable.ts";
export { withoutLines } from "./normalize.ts";
export { parse, regionItems } from "./parser.ts";
export { isRegionText, regionTextProblem } from "./region.ts";
export { isScalar, scalarText, serialize } from "./serialize.ts";
export { itemChildren, skipChildren, stopWalk, walkItems, type RegionPolicy } from "./walk.ts";
