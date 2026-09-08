# Domain docs

How engineering skills should consume this repository's domain documentation.

## Before exploring

Read `CONTEXT-MAP.md`, then read each context file relevant to the work:

- `packages/sdk/CONTEXT.md` — Authoring
- `packages/pdxscript/CONTEXT.md` — PDXScript Syntax
- `packages/codegen-cwt/CONTEXT.md` — CWT Codegen and the corpus
- `packages/codegen-vanilla/CONTEXT.md` — Vanilla Extraction
- `packages/sdk-testing/CONTEXT.md` — Simulation
- `packages/create-stellaris-mod/CONTEXT.md` — Scaffolding

Read relevant system-wide decisions in `docs/adr/`.

If a listed document does not exist, proceed silently.

## Layout

This is a multi-context repository:

- `CONTEXT-MAP.md` is the root context index.
- Each bounded context owns its package-level `CONTEXT.md`.
- `docs/adr/` contains system-wide architectural decisions.

## Use the glossary vocabulary

When output names a domain concept, use the term defined by the relevant
context file. Do not replace defined terms with synonyms.

If a required concept is absent, reconsider whether the term belongs to the
project. If it does, note the gap for domain modeling.

## Flag ADR conflicts

If proposed work contradicts an existing ADR, state the conflict explicitly
instead of silently overriding the decision.
