---
name: code-style
description: Apply clear local code style when writing, refactoring, or reviewing source code. Use for names, function boundaries, data and effect flow, comments, public API documentation, abstraction, composition, and control flow. Architecture and test design belong to their own guidance.
---

# Code Style

This skill governs how implementation communicates intent at the expression, statement, function,
and file level. Use [Engineering Principles](../engineering-principles/SKILL.md) for authority,
module boundaries, interface design, test strategy, and verification. Let project conventions and
observed local evidence override these portable defaults.

## Strength

- **Must** identifies code that would mislead its reader or conceal behavior.
- **Default** identifies the clearest choice unless the code provides contrary evidence.
- **Diagnostic** identifies a reason to inspect the code, not an automatic refactor.

## Working method

1. Read the surrounding code and state the behavior the change must preserve or introduce.
2. Write the smallest direct implementation that follows the local idiom.
3. Read the result as its next maintainer. Remove avoidable cleverness, nesting, indirection, and
   explanation debt.
4. Improve code that the change must touch, but do not expand into unrelated cleanup.
5. Use the project's verification requirements; test design is outside this skill.

## 1. Write simple, direct code

> “Everyone knows that debugging is twice as hard as writing a program in the first place. So if
> you're as clever as you can be when you write it, how will you ever debug it?”
>
> — Brian Kernighan

Prefer the direct, idiomatic implementation with the fewest concepts a reader must hold at once.
Concise code is not necessarily simple: expand an expression into named steps when understanding it
would otherwise require mental execution, unusual language knowledge, or navigation through extra
indirection. Do not add extensibility for a variation that does not exist.

## 2. Give names and functions one truthful purpose

Names describe the role a value plays and the behavior a function performs. They must not hide an
effect or claim a narrower result than the code delivers. Prefer domain meaning such as
`eligiblePlanets` and `serializeTrigger` over placeholders such as `filteredItems`, `processData`,
`helper`, or `manager`.

Extract a function when it owns a coherent operation, rule, effect, useful boundary, or consequential
incidental detail. Do not extract merely to reduce line count. Never create a pass-through function
that only forwards arguments or gives a second name to one obvious expression: it adds navigation
without hiding a decision. Keep the expression inline until the function owns meaningful behavior.
Keep each function at one conceptual level: an orchestration function names its steps; the called
functions contain their details.

## 3. Keep a pure core inside an explicit impure shell

Pure functions own calculations, decisions, validation, and transformations. An impure shell
coordinates input and output. A function that both calculates a rule and performs an effect has two
jobs; split it.

Pass every variable input to a pure function explicitly. It must not secretly read mutable
configuration, clocks, randomness, environment state, storage, or other external sources. Ordinary
parameters are enough; do not introduce dependency-injection machinery without another reason.

The shell may sequence effects, pass results between operations, and make trivial structural
adaptations. A policy branch or meaningful transformation in the shell is a Diagnostic: extract it
into a pure function so the workflow reads at one level.

```ts
import { readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

type Config = { outputDirectory: string };

function calculateOutputPath(filePath: string, config: Config): string {
  return join(config.outputDirectory, basename(filePath));
}

function transformContents(contents: string): string {
  return contents.trim();
}

async function transformFile(filePath: string, config: Config): Promise<void> {
  const contents = await readFile(filePath, "utf8");
  const outputPath = calculateOutputPath(filePath, config);
  const transformedContents = transformContents(contents);

  await writeFile(outputPath, transformedContents);
}
```

## 4. Make code explain itself

Code structure and names explain what the program does. Rewrite code instead of adding a comment
that narrates its syntax or compensates for a vague name.

Use an inline comment only for information code cannot carry: rationale, an external constraint, a
protocol or concurrency requirement, a counterintuitive trade-off, or the provenance of a necessary
workaround. A normative comment should become proportionate enforcement when possible.

## 5. Document the public surface

Every exported declaration and public member has a concise JSDoc description of its purpose. The
JSDocs should explain what the member is, what it does, and how to use it. Add parameter and
return documentation only when meaning, units, constraints, mutation, or failure
behavior is not evident from the signature. Do not repeat type information in prose.

Add an `@example` when correct use requires non-obvious setup, ordering, composition, callbacks,
structured input, or interpretation of a result. The example must teach something the signature and
description do not.

Do NOT narrativize in the JSDocs. Do NOT explain the inner workings of a function. Do NOT drop
project lore or factoids. The consumer doesn't need to know the member's life story. Treat JSDocs
as public documentation, not a novel.

## 6. Apply DRY to knowledge, not text

Use DRY in the Hunt and Thomas sense: each piece of knowledge has one authority. Extract code when
copies must change together because they encode the same rule, policy, or invariant. Keep similar
code separate when it represents different concepts that may change independently. There is no
numeric duplication threshold; small duplication is cheaper than false coupling.

## 7. Prefer composition over inheritance

Use composition when collaborators can vary independently. Inheritance is justified only when the
subtype preserves the parent contract and the hierarchy is the simplest model of the relationship.
Never create a base class solely to reuse implementation.

## 8. Keep the happy path linear

Use guard clauses for invalid, absent, exceptional, and already-complete cases so the main operation
remains direct and unindented. Do not invert every conditional mechanically: keep related
alternatives together when their symmetry is clearer as an `if`/`else` or exhaustive dispatch.

## 9. Decide each distinction once

When the same condition controls several nearby operations, resolve it once into a named value,
selected implementation, or cohesive branch. Repeated checks are the Diagnostic; branches
themselves are not. Engineering Principles governs the larger placement and modeling decision.

## Self-review

- Is this the most direct idiomatic implementation, or merely the shortest?
- Does every name tell the truth, and does every function own meaningful behavior?
- Are decisions and transformations pure, with all variable inputs explicit?
- Do inline comments carry information the code cannot, and is the public surface documented?
- Does each abstraction own shared knowledge rather than shared shape?
- Is inheritance genuinely substitutable, or only an implementation-reuse device?
- Is the main path linear, with each distinction resolved once?
