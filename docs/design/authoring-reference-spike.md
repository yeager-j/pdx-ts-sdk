# Authoring Reference spike

> **Accepted spike design, 2026-08-13.** This document records shared
> understanding and decisions. No spike implementation or production
> Authoring Reference exists yet. The spike requires explicit authorization
> before implementation. ADR-0007 is created only if the spike passes and a
> separate production implementation is approved.

## Shared understanding

### Purpose and reader

The Authoring Reference helps a reader who is comfortable with TypeScript but
knows little Stellaris modding turn an intent into a working Authoring Feature.
API lookup supports that journey; it is not the product's organizing goal.

The reference documents the SDK authoring model. It is not a general Stellaris
wiki and does not claim to document raw PDXScript that the SDK cannot author.
Game facts belong only where they explain an SDK concept or mark its boundary.

### Truth model

Every author-facing claim has one of these statuses:

- **Supported contract** — guaranteed by the current generated Authoring
  surface or its build-time checks.
- **Observed example** — found in a named, versioned game source or corpus
  exemplar. Occurrence is not general legality or a recommendation.
- **Curated convention** — a maintainer judgment about a useful authoring
  pattern, supported by explicit Guidance dependencies.
- **Known omission** — deliberately declined or unsupported SDK behavior with
  a recorded disposition and reason.
- **Unresolved behavior** — available rules, documentation, corpus, or oracle
  evidence does not justify a reliable answer.

Supported contracts read normally. Observations, curation, omissions, and
unresolved behavior are visibly marked. Detailed provenance stays available in
an expandable evidence view so ordinary reading does not become an audit log.

The generator never turns frequency into advice. Corpus evidence can inform a
maintainer, but a Curated convention remains a human decision.

### Preventing stale curation

Each Curated convention names stable semantic facts and evidence through
Guidance dependencies. Codegen computes documentation-relevant semantic
fingerprints rather than hashing generated formatting or file locations.

A change to a depended-on Supported contract invalidates the guidance and
fails the documentation gate until it is reviewed. Changed observations create
an explicit review item; they do not automatically make a recommendation
wrong. A last-reviewed date is not evidence of freshness.

Executable examples have an independent freshness gate: they must continue to
typecheck, build, and synthesize against the matching SDK.

### Content layers

The Authoring Reference combines three layers without flattening their
authority:

1. A **Generated authoring reference** projects supported forms, fields,
   scopes, references, dispositions, provenance, and gaps from source-owning
   contexts.
2. **Curated guidance** explains intent, structure, conventions, and choices.
3. **Hand-written concepts** explain game or SDK ideas that cannot be derived
   safely.

Reference pages may show both kinds of executable teaching content:

- A **Verified example** is deterministic hand-written or generated source that
  typechecks, builds, and synthesizes.
- A **Recipe example** is a Verified example produced by an existing Recipe.
  It is preferred when available but is not the only valid example.

This follows the shadcn/ui distinction: [Blocks](https://ui.shadcn.com/blocks)
are composed, installable starting points, while component documentation such
as [Table](https://ui.shadcn.com/docs/components/base/table) includes several
focused, page-local examples.

### Product boundary

The eventual product is an offline, read-only local web app:

- It displays one immutable, versioned Reference build.
- It does not inspect or change an author's project.
- It requires no hosted service, account, network, or Stellaris install.
- A local launcher serves bundled static files on a loopback address and opens
  the app in a browser.
- The same static bundle could be hosted later without changing the knowledge
  model, but hosting is not required.

Navigation is organized around Authoring concepts and registries rather than a
raw TypeScript export list. A registry page leads from the game concept to a
minimal Feature, curated choices, the complete supported field reference,
related callables and recipes, limitations, and provenance. A symbol index is
secondary.

Local deterministic search indexes concept names, TypeScript symbols,
PDXScript keys, game terms, and curated aliases. It supports filters such as
registry, scope, and claim status. AI or semantic search is outside the initial
product.

### Version identity

A Reference build records the exact SDK version or commit, CWT source revision,
Paradox documentation revision, corpus game version, and vanilla-identifier
version that support its claims. Evidence from different builds is never
presented as one timeless view.

The structured Reference build schema is internal. It carries a `schemaVersion`
so the viewer can reject incompatible data, but it is not exported as a public
tooling contract. If third-party machine consumers become an explicit product,
they receive a separately designed consumer schema.

### Context ownership and dependency direction

Authoring Reference is a seventh bounded context. It owns the claim model,
Reference build assembly, search index, and local viewer. It does not own SDK
legality, Recipe topology, Curated convention decisions, or game evidence.

Source-owning contexts emit deterministic, producer-owned Reference
contributions:

- CWT Codegen projects post-overlay supported facts, dispositions, and
  unresolved evidence.
- Scaffolding contributes Curated conventions, Guidance dependencies, Verified
  examples, and Recipe examples.
- Repository build metadata supplies exact source versions.

Producer contributions are committed and reviewed with the source facts or
guidance they project. The assembled browser bundle and search index are
derived build outputs and are not committed.

The dependency is one-way: Authoring Reference consumes contributions. The SDK,
CWT Codegen, and Scaffolding never read the assembled Reference build back.

## Reference spike

### Hypothesis

The spike tests this claim:

> A Reference contribution derived from the real post-overlay authoring model,
> combined with dependency-checked curated guidance and a Verified example,
> can teach one difficult SDK capability without duplicating legality or hiding
> uncertainty.

The risky assumption is documentation quality, not whether a local static app
or search field can be programmed.

### Quarantine

All spike implementation lives in `packages/reference-spike`, with private npm
name `@pdx-ts/reference-spike`. No production package may import it. The spike
is never renamed, moved, published, or promoted into the production Authoring
Reference.

The spike has one deliberate module-boundary exception: a single Codegen probe
may read CWT Codegen internals. This is a real information-hiding violation,
not a production design. It is proportionate only because:

- one named adapter owns the violation;
- it immediately refines internal data into an immutable, spike-owned
  `SituationReferenceFacts` value;
- an architecture gate forbids internal codegen imports elsewhere and forbids
  production imports from the spike;
- deleting the spike deletes the exception;
- the result proves derivability and usefulness, not the eventual production
  contribution interface.

If the spike passes, CWT Codegen receives a separately designed producer-owned
Reference contribution interface. The probe is not copied.

### Situation vertical slice

Situation is intentionally harder than a typical scalar-heavy registry. It
combines nested definitions, localization, progress mechanics, scopes,
references, triggers and effects, hand-written SDK contracts, corpus evidence,
and known upstream contradictions.

The Verified example contains:

- one `mod.situationType` with `targetScope: "planet"`;
- required `monthlyProgress`;
- two distinct stages;
- two distinct approaches;
- generated localization and nested identities; and
- one typed `startSituation` use.

Two stages and approaches are required because a single child proves only one
happy path. Two exercise repeated identity, localization, ordering, and emitted
layout behavior.

The reference page must not smooth over these difficult facts:

- `targetScope` is an SDK-authored, author-asserted, non-serialized contract,
  not a CWT-derived field.
- `stages` and `approach` use different emitted layouts.
- The conditional `picture` block form is a Known omission.
- Stage-color prose and the generated input type currently contradict each
  other.
- `totalProgress` and stage progress-mode combinations remain unresolved where
  the available evidence cannot justify a rule.
- Corpus observations, including uncommon forms below the presence floor, are
  evidence rather than legality.

There is no Situation Recipe today. The spike owns a hand-written Verified
example and does not add a production Recipe. If a relevant Recipe exists in a
future Reference build, the page shows its Recipe example alongside narrower
hand-written examples.

### UI and launcher

The disposable viewer uses React, Vite, Tailwind CSS, and only the shadcn/ui
components needed by the spike. These established primitives reduce custom
mechanism and speed up the experiment. The spike adds no router, state library,
or reusable component system without a concrete need.

Package-local scripts build and launch the app. A small Node server binds only
to `127.0.0.1`, serves the built assets, and prints its URL. The spike does not
add a root command, modify scaffolded projects, or implement cross-platform
browser opening. The eventual production launcher retains the open-in-browser
product decision.

### Acceptance

The spike passes only if all of these claims hold:

- The Situation facts are derived from the real post-overlay model through the
  quarantined Codegen probe.
- Two stages and two approaches retain distinct identities, localization,
  order, and emitted layouts.
- The Verified example typechecks, builds, and synthesizes.
- The page visibly distinguishes Supported contracts, Observed examples,
  Curated conventions, Known omissions, and Unresolved behavior.
- `targetScope` is presented as an SDK-authored contract.
- Search finds the page through SDK names and PDXScript terms.
- A deliberate semantic contract change breaks projection parity.
- A deliberate change to a Guidance dependency invalidates curated guidance.
- Known color, `picture`, and progress-mode problems remain visible instead of
  becoming plausible-looking guesses.
- The critical user flow is verified through the running local app, not code
  inspection alone.

Passing means the whole evidence-to-page chain works. Rendering an attractive
page is insufficient.

### Evidence environment

Building, running, and testing the spike is hermetic. It uses vendored CWT and
documentation inputs plus committed, game-versioned corpus evidence.

When a matching local Stellaris install is available, spike completion also
includes an Install audit. The audit may inspect complete vanilla Situation
examples, shipped documentation, field combinations, and drift against
committed evidence. Only sanitized observations, counts, versions, and hashes
may be committed—never proprietary script bodies or localization.

Install inspection can strengthen an Observed example or preserve a gap as
Unresolved behavior. It does not establish a Supported contract unless the SDK
surface is also corrected. Launching a live-game oracle is reserved for a
specific runtime claim that blocks honest documentation.

### Handback

Implementation stops with:

- the quarantined `packages/reference-spike` package;
- a generated, provenance-bearing Situation snapshot;
- the two-stage, two-approach Verified example and `startSituation` use;
- the local searchable reference page;
- hermetic gates and their demonstrated negative controls;
- the Install audit when matching evidence is available; and
- a short outcome report covering evidence, defects, unsupported assumptions,
  and the hypothesis verdict.

The handback contains no production Authoring Reference implementation.

### Disposition

The outcome requires an explicit user decision:

- **Fail:** delete the spike package and retain the outcome explaining why.
- **Inconclusive:** delete it or authorize a separately scoped experiment.
- **Pass:** design and implement production boundaries separately. Do not
  rename, move, publish, or otherwise promote spike code.

ADR-0007 is created only after a pass **and** an explicit decision to implement
the production feature. If the feature is not implemented, no ADR is needed.

### Non-goals

The spike does not include:

- production Authoring Reference code or public packages;
- a public Reference build schema;
- broad registry, trigger, effect, or Recipe coverage;
- project inspection or source modification;
- hosted deployment, accounts, telemetry, or network services;
- AI or semantic search;
- arbitrary TypeScript execution in the browser;
- a new Situation Recipe;
- UI framework or design-system architecture for the production app; or
- ADR-0007.

## Decision log

All decisions were accepted on 2026-08-13. Rows marked **superseded** record an
important rejected route; the replacement row is authoritative.

| ID   | Decision                                 | Outcome and rationale                                                                                                                                                                                   |
| ---- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1   | Primary reader and job                   | Optimize for a TypeScript-capable author with little Stellaris knowledge who wants to reach a working Feature.                                                                                          |
| Q2   | Product boundary                         | Document SDK authoring. Do not attempt a general raw-PDXScript or game wiki.                                                                                                                            |
| Q3   | Truth model                              | Preserve Supported contract, Observed example, Curated convention, and Unresolved behavior as distinct statuses with provenance. Known omission was added as the explicit SDK-gap status.               |
| Q4   | Curation freshness                       | Curated guidance declares semantic Guidance dependencies. Contract drift fails; evidence drift requires review. Dates alone do not establish freshness.                                                 |
| Q5   | Primary surface — **superseded**         | A browsable static reference was initially proposed as the primary surface.                                                                                                                             |
| Q5r  | Local app                                | Use an offline, read-only local web app. It displays a versioned Reference build and does not inspect the author's project. Hosting remains optional.                                                   |
| Q6   | Information architecture                 | Organize by Authoring concepts and registries, with a secondary complete symbol index.                                                                                                                  |
| Q7   | Evidence presentation                    | Present Supported contracts normally; mark other statuses visibly; keep detailed provenance expandable.                                                                                                 |
| Q8   | Version identity                         | A Reference build records exact SDK, CWT, documentation, corpus, and vanilla-identifier versions.                                                                                                       |
| Q9   | Reference source                         | Project documentation directly from the real post-overlay Supported authoring model. Do not reconstruct it from emitted TypeScript or use it as a legality input.                                       |
| Q10  | Coverage boundary                        | Show supported behavior, Known omissions, and Unresolved behavior. Mere absence is not a Known omission.                                                                                                |
| Q11  | Page composition                         | Lead from concept and minimal Feature through curated choices, complete supported fields, related callables and Recipes, limitations, and evidence.                                                     |
| Q12  | Examples                                 | Display copyable Verified examples; do not execute arbitrary TypeScript in the app.                                                                                                                     |
| Q13  | Search                                   | Index SDK and game language with deterministic local search and filters. Defer AI and semantic search.                                                                                                  |
| Q14  | Bounded context                          | Authoring Reference is a seventh bounded context that owns claims, assembly, search, and viewing, not source facts or legality.                                                                         |
| Q15  | Boundary crossings                       | Producers emit deterministic contributions; Authoring Reference consumes them one-way and never feeds the assembled build back.                                                                         |
| Q16  | Package boundary                         | The eventual product belongs in separate `packages/authoring-reference`, not the SDK or scaffolder. Keep it private until publication is a deliberate decision.                                         |
| Q17  | Schema stability                         | Keep the Reference build schema internal and versioned. Design a separate consumer schema only for an approved external-tooling use case.                                                               |
| Q18  | Generated ownership                      | Commit producer contributions for review. Derive viewer assets and search indexes during build.                                                                                                         |
| Q19  | Spike hypothesis                         | Test whether real model facts plus dependency-checked curation and a Verified example can honestly teach one difficult capability. Include semantic negative controls.                                  |
| Q20  | Technology slice — **superseded**        | Technology was proposed as the smallest complete registry slice but rejected as too easy.                                                                                                               |
| Q20r | Situation slice                          | Use Situation as the stress test. Two stages and two approaches are required to exercise repeated identity, localization, order, and layout.                                                            |
| Q21  | Spike location — **superseded**          | An experimental first slice inside the intended production package was rejected because temporary code is often promoted accidentally.                                                                  |
| Q21r | Quarantine                               | Put all spike implementation in `packages/reference-spike`. It cannot be promoted in place.                                                                                                             |
| Q22  | Example ownership                        | Verified examples may be hand-written or Recipe-produced. Show relevant Recipe examples when they exist, following the shadcn/ui Blocks-and-component-examples model.                                   |
| Q23  | Acceptance                               | Require the complete generated-facts, curation, example, page, search, parity, stale-guidance, and user-flow chain to pass.                                                                             |
| Q24  | Hermetic only — **superseded**           | The first recommendation allowed live evidence only as later research.                                                                                                                                  |
| Q24r | Two-tier evidence                        | Keep build and CI hermetic, but perform an Install audit when matching local evidence is available. Use a live-game oracle only for a blocking runtime claim.                                           |
| Q25  | Private internal import — **superseded** | Treating quarantine as sufficient permission to import CWT Codegen internals was rejected under the engineering principles.                                                                             |
| Q25r | Codegen probe exception                  | Acknowledge one architecture-tested information-hiding violation in the spike, refine immediately into spike-owned facts, and narrow the result to derivability rather than production-interface proof. |
| Q26  | Frameworkless UI — **superseded**        | Custom frameworkless TypeScript was rejected because established UI primitives reduce spike mechanism and development time.                                                                             |
| Q26r | UI stack                                 | Use React, Vite, Tailwind CSS, and only needed shadcn/ui components. Add no extra framework without evidence.                                                                                           |
| Q27  | Launch behavior                          | Use package-local scripts and a loopback-only Node server that prints the URL. Do not add root or scaffold integration.                                                                                 |
| Q28  | Handback                                 | Return the quarantined package, provenance-bearing data, Verified example, local app, gates, audit when available, and outcome report—no production code.                                               |
| Q29  | Disposition                              | Require an explicit fail, inconclusive, or pass decision. Even on pass, production starts separately.                                                                                                   |
| Q30  | ADR timing                               | Do not create ADR-0007 for the spike. Create it only after a pass and an explicit production implementation decision.                                                                                   |
