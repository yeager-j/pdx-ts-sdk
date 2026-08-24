/**
 * A compact form of a generated method signature for a table's type column:
 * parameter names without their types, plus the return type —
 * `abortSituation(value: ScopeValue<"situation">): void;` becomes
 * `(value) => void`. The full signature belongs in the row's detail view;
 * the column only needs enough shape to scan.
 *
 * Returns `undefined` when the string does not look like a method signature,
 * so the caller can fall back to a generic label instead of showing
 * something wrong.
 */
export function summarizeSignature(signature: string): string | undefined {
  const overloadCount = signature.split("\n").filter((line) => line.trim() !== "").length;
  if (overloadCount > 1) {
    return `${overloadCount} overloads`;
  }

  const open = signature.indexOf("(");
  if (open === -1) {
    return undefined;
  }

  // Bracket-matching over (, [, {, and generic <>. An arrow's `>` is not a
  // closer, so `=>` inside a callback parameter must not move the depth.
  let depth = 0;
  let close = -1;
  for (let index = open; index < signature.length; index += 1) {
    const character = signature[index];
    if (character === "(" || character === "[" || character === "{" || character === "<") {
      depth += 1;
    } else if (
      (character === ")" || character === "]" || character === "}" || character === ">") &&
      !(character === ">" && signature[index - 1] === "=")
    ) {
      depth -= 1;
      if (depth === 0) {
        close = index;
        break;
      }
    }
  }
  if (close === -1 || signature[close] !== ")") {
    return undefined;
  }

  const names: string[] = [];
  let paramDepth = 0;
  let current = "";
  const push = (): void => {
    const trimmed = current.trim();
    if (trimmed !== "") {
      const name = trimmed.split(":")[0]?.trim();
      if (name !== undefined && name !== "") {
        names.push(name);
      }
    }
    current = "";
  };
  for (let index = open + 1; index < close; index += 1) {
    const character = signature[index];
    if (character === "(" || character === "[" || character === "{" || character === "<") {
      paramDepth += 1;
    } else if (
      (character === ")" || character === "]" || character === "}" || character === ">") &&
      !(character === ">" && signature[index - 1] === "=")
    ) {
      paramDepth -= 1;
    } else if (character === "," && paramDepth === 0) {
      push();
      continue;
    }
    current += character;
  }
  push();

  const returnType = signature
    .slice(close + 1)
    .trim()
    .replace(/^:\s*/, "")
    .replace(/;\s*$/, "")
    .trim();
  if (returnType === "") {
    return undefined;
  }

  return `(${names.join(", ")}) => ${returnType}`;
}
