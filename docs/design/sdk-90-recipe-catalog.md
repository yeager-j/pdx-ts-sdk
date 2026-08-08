# Recipe Catalog — implementation specification

Assembled from the
[Interactive `generate` command that scaffolds feature recipes](https://linear.app/unnamed-system/issue/SDK-90/interactive-generate-command-that-scaffolds-feature-recipes)
Wayfinder map and its closed decisions. The later
[implementation-model decision](https://linear.app/unnamed-system/issue/SDK-114/choose-the-built-in-recipe-catalog-implementation-model-after-design)
supersedes the earlier Template-schema, declarative Item-plan, and generic-renderer
route. The closed tickets retain that discussion history; this document states
only the accepted implementation route.

**Deviation rule.** An executing agent who must deviate from this specification
updates this document and the affected Linear issue in the same change. The
specification and delivery tickets never disagree silently.

Per the repository documentation rule, delete this file once the work ships.

## Destination

A built-in Recipe Catalog exposed through `create-stellaris-mod list`, `view`,
and `generate`. It installs curated, copy-owned, single-file TypeScript starters
for `technology`, `building`, `event`, and `research-quest`, with finite Intent
questions only where an answer changes structure. Untouched output typechecks
and builds against the supported SDK.

The catalog follows the source-distribution shape that motivated it: an Item
recipe is analogous to installing one component, while a Feature recipe is
analogous to installing a coordinated block. Those are explanatory analogies;
the canonical Scaffolding vocabulary remains Item recipe and Feature recipe.

## Vocabulary and authority

The Scaffolding glossary in `packages/create-stellaris-mod/CONTEXT.md` is the
authority for Project Manifest, Recipe Catalog, Item recipe, Feature recipe,
Recipe, Recipe renderer, Generated Feature Source, Recipe topology, Curated
starter, Measured evidence, Curated convention, Default answer, and Intent
question.

Two independent axes recur:

- **Item versus Feature** describes output composition: one Item versus several
  coordinated Items. Both emit exactly one Authoring Feature file.
- **Zero-question versus guided** describes interaction. A zero-question recipe
  still adds value by installing a reviewed, working source pattern.

The generated SDK TypeScript surface is the executable authority for what can
be authored. Scaffolding does not carry a second field schema, reinterpret CWT,
or validate SDK legality at runtime. Its baked recipes are proved against the
SDK during package verification and fenced by an explicit compatible SDK range
at generation time.

## Scaffolder boundary and Project Manifest

The boundary established by
[Preserve the scaffolder boundary while adding catalog commands](https://linear.app/unnamed-system/issue/SDK-96/preserve-the-scaffolder-boundary-while-adding-catalog)
remains in force.

- `create-stellaris-mod init [directory]` is the canonical project-scaffold
  command. Bare `create-stellaris-mod [directory]` remains a compatibility
  shorthand. `init`, `list`, `view`, and `generate` are reserved first-position
  command names.
- `list`, `view`, and `generate` are the public Catalog interface. Recipe
  definitions and renderers are private package implementation.
- `create-stellaris-mod` is transient and independently released. Generated
  projects retain no scaffolder dependency, installation state, recipe history,
  upgrade metadata, or generated-file inventory.
- The CLI has no runtime dependency on `@pdx-ts/sdk`. The SDK remains a
  development-time proof dependency of the scaffolder package.

`stellaris-mod.json` is the Project Manifest: the single author-owned source of
truth for mod identity, launcher metadata, and Feature source placement.

- The sole key under `mod` is the mod prefix, so `keyof typeof manifest.mod`
  recovers it exactly.
- That entry carries the complete SDK `ModConfig` other than `prefix`.
- `contentDirectory` is the only Scaffolding-specific field in this delivery.
- `src/mod.ts` is wiring from the manifest to `createMod`, not a second
  configuration source.
- The JSON schema and runtime adapter both enforce exactly one mod entry and
  the prefix grammar.
- `init` always creates the manifest. `generate` consumes it and never creates,
  repairs, or migrates it.
- `generate` searches upward for the manifest. `--cwd <path>` changes the
  search start. `list` and `view` remain project-independent.
- The scaffolded package exposes `"#mod": "./src/mod.ts"` through
  `package.json#imports`; every Generated Feature Source imports
  `import { mod } from "#mod"` rather than computing a relative path.

Each scaffolder release declares the exact semver range against which its baked
recipes were verified:

- A semver project dependency must be a subset of that verified range. Merely
  overlapping it is insufficient because a later install could select an
  unverified SDK.
- When an installed SDK version is available, it must satisfy both the declared
  project range and the verified range.
- Non-semver specifications such as `file:` or an absent installed version that
  cannot prove compatibility fail before prompting unless the author supplies
  `--allow-unsupported-sdk`.
- The override changes only the preflight decision. It does not load the SDK,
  weaken generated source, or suppress any later project build failure.

## Catalog module

The Catalog is a pure in-process module. The exact types are private and may
change, but the implementation must preserve this depth:

```ts
interface RecipeCatalog {
  list(): readonly RecipeSummary[];
  view(id: string): RecipeView;
  generate(request: GenerateRecipeRequest): GeneratedFeatureSource;
}

interface GenerateRecipeRequest {
  readonly recipeId: string;
  readonly name: string;
  readonly answers: Readonly<Record<string, string>>;
}

interface GeneratedFeatureSource {
  readonly stem: string;
  readonly basename: `${string}.ts`;
  readonly contents: string;
}
```

`generate` performs no filesystem, terminal, environment, clock, random, or
network access. Identical normalized requests return identical values. Dry-run
and real publication consume the same `GeneratedFeatureSource` instance.

`RecipeSummary` contains the recipe id, title, short summary, Item/Feature
classification, and the Item kinds it creates. `RecipeView` adds its ordered
questions, choices, defaults, help, output filename pattern, and a copyable
non-interactive command. This metadata is descriptive; it does not drive a
generic renderer or claim to enumerate the SDK surface.

## Recipe definitions and renderers

Every baked recipe is a trusted private TypeScript module. Its conceptual seam
is:

```ts
interface RecipeDefinition<Q extends readonly ChoiceQuestion[]> {
  readonly summary: RecipeSummary;
  readonly questions: Q;

  render(input: { readonly names: DerivedNames; readonly answers: AnswersOf<Q> }): string;
}
```

`defineRecipe` provides type inference and validates the discovery/question
protocol. It is not a template language.

- Questions are a static ordered tuple of finite choices. Every question has a
  unique kebab-case key, prompt, non-empty choice set, Default answer, and help.
- The command-line flag is `--<question-key>`. Recipe keys cannot collide with
  common `generate` flags.
- No starter question is conditional. There is no `askWhen`, predicate algebra,
  loop primitive, binding language, handle graph, or Resolved-plan layer.
- If a future accepted recipe needs conditional prompting, introduce the
  smallest finite decision-tree seam that its concrete flow demonstrates. Do
  not preserve unused conditional machinery now.

A Recipe renderer owns its complete source shape:

- imports and namespace declarations;
- Item declaration order and cross-Item variables;
- callback and effect closures;
- answer-dependent branches, loops, and local computation;
- curated active fields and optional examples;
- recipe-specific explanations and the ownership header;
- final `feature` assembly and named export.

The renderer may use ordinary recipe-local functions and small shared lexical
helpers such as safe TypeScript string quoting or joining source blocks. There
is no shared field walker, import assembler, Item-plan interpreter, source AST,
or generic TypeScript renderer. A new structural idiom normally changes one
recipe module.

Only closed inputs enter source:

- the requested name goes through one validated derivation into a snake-case
  logical name/stem/basename and guarded camel-case TypeScript identifiers;
- string literals use one JSON-compatible TypeScript quoting function;
- recipe answers come from finite recipe-owned choices;
- all remaining source text is package-authored;
- no user-provided code or remotely supplied recipe is executed.

Each renderer emits a short ownership header identifying its recipe and stating
that the file is now the author's. There is no machine-readable installation
marker, version stamp, or later read-back operation.

## Curated starter policy

Recipes teach working structures, not every legal SDK input. The SDK types,
JSDoc, and editor completion are the comprehensive authoring surface.

- Required and idiom-defining structure is active.
- Required author text uses a greppable `PLACEHOLDER: <label>` value while
  remaining type-correct and buildable.
- Enums and numbers use reviewed conventional starter values rather than
  sentinel values likely to ship accidentally.
- A small optional field may be shown commented only when it materially teaches
  the idiom. The example must be uncomment-ready with the file's existing
  imports and in-scope names.
- Alternative structural arms are selected by Intent questions when the choice
  belongs in generation. Mutually impossible fields are absent from the chosen
  source branch.
- A new SDK field does not automatically change a recipe. Maintainers change a
  Curated starter only when the convention being taught should change.

The evidence policy from
[Establish the vanilla evidence for the starter recipes](https://linear.app/unnamed-system/issue/SDK-99/establish-the-vanilla-evidence-for-the-starter-recipes)
and
[Decide how evidence becomes branching and defaults](https://linear.app/unnamed-system/issue/SDK-101/decide-how-evidence-becomes-branching-and-defaults)
remains: **Authoring constrains, curation selects, measurement informs.**

- The SDK surface and compiler decide whether authored source is legal.
- Curated conventions decide questions, defaults, topology, starter values,
  optional examples, and author-facing explanations.
- Measured evidence ranks and informs curation but never changes generation at
  runtime. No recipe binds mechanically to corpus frequencies.
- Missing evidence produces a conspicuous generic placeholder or omission, not
  a meaningful-looking invented value and not a new leaf-value prompt.
- Maintainer-facing source comments may cite documentation, exemplars, or the
  [starter evidence](https://github.com/yeager-j/pdx-ts-sdk/blob/research/sdk-90-vanilla-evidence/docs/design/sdk-90-vanilla-evidence.md).
  Generated prose states only the resulting conclusion.
- Identifiers, structure, numeric conventions, and scope facts may inform
  curation. Verbatim vanilla script bodies and localized text never enter the
  catalog.

## Starter catalog

### Technology

A zero-question Item recipe and the first vertical tracer.

- Emits one technology Item and one Feature.
- Activates identity/localization plus the conventional area, category, tier,
  and scalar-cost shape.
- Includes only a few reviewed optional examples such as prerequisites or
  weight when they remain short and uncomment-ready.
- Does not attempt to mirror every technology field.

### Building

A zero-question Item recipe.

- Emits one building Item and one Feature.
- Activates a conventional building category/set, build time, and simple
  resource shape alongside identity/localization.
- May include reviewed prerequisite or upgrade examples.
- Keeps documented exceptional building-set forms outside this starter.

### Event

A guided Item recipe with two ordered questions:

1. `visibility`: `visible` (Default) or `hidden`.
2. `event-kind`: `country`, `planet`, `ship`, or `fleet` (`country` Default).

The renderer maps those curated choices to the corresponding supported event
authoring methods. A visible event includes title, description, and an option;
a hidden event emits the supported hidden form and omits window-only fields.
The selected kind fixes the root callback scope throughout the source.

These four kinds are a curated onboarding subset, not a runtime projection of
every `EVENT_KINDS` member. Package tests assert that each remains supported by
the SDK.

### Research quest

A guided Feature recipe and the architecture-acceptance case.

- One `projects` question: `one` (Default) or `two`.
- Emits one event chain, one starter event, one or two special projects, the
  corresponding completion events, one on-action registration, and one Feature
  containing all coordinated Items.
- Cross-Item references are ordinary TypeScript variables and SDK values in the
  emitted source—never Scaffolding handles.
- The two-project branch owns its correlation and control flow locally in this
  renderer.
- Topology follows the reviewed subterranean-civilization evidence, never its
  script body or localized text.

This recipe must prove real event scopes, callbacks, reference cycles or
forward-handle techniques required by the current Authoring API, and actual mod
synthesis. If that concrete source exposes an Authoring defect, open a focused
SDK ticket for the canonical defect and block this recipe on it. A speculative
event overlay is not a prerequisite.

## Command behavior

The interaction accepted by
[Prototype catalog discovery and the starter recipe flows](https://linear.app/unnamed-system/issue/SDK-102/prototype-catalog-discovery-and-the-starter-recipe-flows)
remains the UX authority. The prototype is interaction evidence only; its
per-recipe functions, surfaces, and generated SDK calls are not liftable
implementation architecture.

### Parsing

Parsing is deliberately two-phase because recipe flags are dynamic:

1. Parse the command, optional recipe id and name, and common flags while
   retaining unconsumed arguments.
2. Resolve the recipe, compile its question keys into a strict flag table, and
   parse the remainder. Unknown, duplicate, or unreachable values fail.

Common flags include `--cwd`, `--yes`, `--dry-run`, and
`--allow-unsupported-sdk`. Name remains positional with prompt fallback and is
not an Intent question.

### Discovery

- Bare `generate` opens a type-to-filter picker with title, Item/Feature label,
  and short summary when prompting is available. When stdin is non-TTY, the
  recipe id and name are both required; `generate --yes` without either fails
  before Project Manifest discovery.
- `list` prints deterministic summaries and requires no project.
- `view <recipe>` prints metadata, every question/flag/choice/Default/help, the
  output filename pattern, and a copyable `generate` command. It requires no
  project.

### Generate order

`generate` performs these operations in order:

1. Resolve the command and recipe.
2. Discover and validate the Project Manifest.
3. Validate `#mod`, `contentDirectory`, and SDK compatibility.
4. Resolve or prompt for the name and derive all names once.
5. In interactive mode, present the target path and logical-name facts through
   the terminal adapter on stderr. Non-interactive runs omit this preview.
6. Resolve each static question in order: a supplied flag wins; `--yes` and
   non-TTY operation use Default answers; otherwise prompt.
7. Call the pure Catalog and obtain Generated Feature Source.
8. Perform a non-mutating preflight of the target and its existing ancestors.
9. In interactive mode, confirm the exact target path.
10. Print byte-identical dry-run output or create any missing directories and
    publish exclusively.

Cancellation at any prompt prints `Nothing was written.` and exits 130.
Cancellation and dry-run leave missing content directories absent. Non-TTY
operation without a recipe id or name fails rather than hanging. Successful
real generation writes exactly the generated path plus one newline to stdout;
interactive previews, answer-source echoes, prompts, and confirmation remain
on stderr.

Dry-run performs every non-mutating preflight and renders the exact bytes a real
run would publish. It does not ask for the step 9 confirmation: nothing will be
written, so there is nothing to ask permission for. It prints
`would write <path>` plus the source to stdout. If the target exists, it also
reports that a real run would refuse but still exits zero; failures that prevent
rendering remain nonzero.

## Source formatting

Recipe renderers return already formatted source. The runtime does not depend
on Prettier or any TypeScript printer.

- Every reachable variant is required to be byte-stable under the repository's
  pinned/default Prettier configuration.
- The stability corpus includes canonical and boundary-length legal names so
  interpolation cannot silently introduce wrapping drift.
- This is not a promise about an author's custom formatter configuration after
  generation.
- Source always ends with one newline and uses repository-standard imports and
  ESM `.ts` conventions where relative imports occur.

## Path containment and exclusive publication

`contentDirectory` is a normalized project-relative logical path.

- Reject absolute paths, empty segments, `.`, `..`, NUL, platform separators
  that do not match the logical form, and any normalization that changes the
  intended segment sequence.
- Resolve the discovered Project Manifest root to its real path.
- Walk every existing `contentDirectory` segment with `lstat`; every segment
  must be a real directory, never a symlink or other dirent.
- At the first missing segment, record the remaining suffix and stop. Preflight
  never creates a directory.
- Resolve the deepest existing ancestor and require real-path containment
  beneath the manifest root before rendering or prompting for confirmation.

The target basename comes only from validated name derivation. The publisher
must never replace any existing dirent, including a file, directory, or
symlink:

1. After confirmation, create missing `contentDirectory` segments one at a
   time. If a segment races into existence, inspect it rather than accepting
   it; every resulting segment must be a real directory, never a symlink.
2. Resolve the completed directory and require real-path containment beneath
   the manifest root again.
3. Create an unpredictable temporary file in the target directory with
   exclusive creation.
4. Write the complete bytes, flush them, and close the file.
5. Publish with an atomic no-replace operation. On supported local filesystems,
   hard-linking the temporary file to the target provides this guarantee:
   `EEXIST` is a collision, never permission to overwrite.
6. Unlink the temporary name after publication. A crash between link and
   cleanup may leave a complete target plus an orphaned temporary file, never a
   partial or replaced target.
7. If the filesystem cannot provide the no-replace guarantee, fail loudly. Do
   not fall back to ordinary `rename`, whose overwrite semantics make a prior
   `lstat` race-unsafe.

Tests use real temporary directories and cover traversal, absolute paths,
symlinked ancestors, every target-dirent kind, a target introduced at the
publication boundary, cleanup, unsupported-publication failure, and missing
directories remaining absent after dry-run or cancellation.

## Verification gates

### Catalog protocol

A hermetic package test rejects:

- duplicate or invalid recipe ids;
- duplicate question keys, empty choice sets, and invalid Defaults;
- question/common-flag collisions;
- mismatches between declared Item/Feature classification and the reviewed
  recipe output contract;
- nondeterminism from two renders of the same normalized request.

There is deliberately no field-level catalog validator. The TypeScript compiler
and executed build validate the generated artifact itself.

### Exhaustive source matrix

All questions are static, so verification enumerates the full Cartesian product
of each recipe's choices and asserts the count:

- technology: 1;
- building: 1;
- event: 8 (`2 × 4`);
- research-quest: 2;
- total starter variants: 12.

For every variant, the harness:

1. calls the real Recipe renderer;
2. compares its bytes with a reviewed committed golden;
3. renders it a second time and requires identical bytes;
4. runs pinned/default Prettier and requires identical bytes;
5. places it in the real golden fixture project;
6. runs `tsc -p` over that project;
7. executes discovery, Fold, render, and synthesis into a temporary directory;
8. asserts the expected registry files and recipe identities exist.

The fixture project has its own `package.json#imports`, Project Manifest, and
`src/mod.ts`, and is excluded from the root TypeScript program. One negative
control deliberately introduces an invalid generated call and proves the
compiler gate fails rather than passing vacuously.

A separate adversarial-name corpus covers punctuation normalized by policy,
apostrophes, reserved words, leading digits, Unicode rejection/normalization
boundaries, and the maximum accepted length. It must compile, build, remain
formatted, and show no source injection.

### CLI and filesystem

- Programmatic CLI invocation uses injected stdin/stdout/stderr and returns an
  exit code. Golden transcripts cover `list`, every `view`, Default and
  flag-supplied generation, dry-run, invalid flags, invalid manifest/SDK,
  collisions, cancellation, missing non-TTY recipe, and missing non-TTY name.
- Interactive tests cover picker/question order, flag-beats-prompt, echoing the
  answer source, confirm-before-write, exit 130, and stderr/stdout separation.
- One child-process smoke test invokes the real binary once to prove argv,
  shebang, filesystem wiring, and actual process exit behavior.
- Real-filesystem tests prove containment and exclusive publication. Filesystem
  substitution is not used as a stand-in for these guarantees.

### Repository gates

Each implementation slice finishes with the relevant focused tests plus:

```sh
npm run typecheck
npm test
npm run build
```

No new Template-schema generation or widened `codegen:check` tree is part of
this delivery. If a concrete recipe requires an Authoring/codegen fix, that
separate change follows the repository's normal codegen gates.

## Delivery sequence

Implementation work lives beneath
[Deliver the built-in Recipe Catalog](https://linear.app/unnamed-system/issue/SDK-115/deliver-the-built-in-recipe-catalog)
rather than under the planning-only Wayfinder map.

### 1. [Catalog foundation and technology tracer](https://linear.app/unnamed-system/issue/SDK-109/catalog-foundation-and-technology-tracer)

Project Manifest generation/consumption, command routing, two-phase parsing,
terminal seam, Catalog interface, name derivation/quoting, compatibility
preflight, path containment, exclusive publisher, dry-run, and one real
technology Recipe renderer through golden, compiler, build, transcript, and
binary-smoke gates.

This is the only foundation slice; it must end in a useful generated file.

### 2. [Research-quest executable recipe vertical slice](https://linear.app/unnamed-system/issue/SDK-112/research-quest-executable-recipe-vertical-slice)

The complex Feature renderer, its one-versus-two-project matrix, real callbacks
and cross-Item references, and executed synthesis. This is the architecture
acceptance gate. Any demonstrated Authoring defect becomes a focused external
blocker; no generalized Scaffolding language is added to avoid recipe-local
TypeScript.

### 3. [Building and guided event executable recipes](https://linear.app/unnamed-system/issue/SDK-111/building-and-guided-event-executable-recipes)

The remaining zero-question Item starter and the visibility/event-kind matrix,
with their goldens and CLI transcripts. Event choices are checked against the
current SDK at package verification time.

### 4. [Add-recipe skill and Recipe Catalog release verification](https://linear.app/unnamed-system/issue/SDK-113/add-recipe-skill-and-recipe-catalog-release-verification)

Write `.agents/skills/add-recipe/SKILL.md` from the proven workflow: classify
Item versus Feature, decide whether a structural Intent question is warranted,
author the private Recipe renderer, add its reachable matrix and goldens, add
transcripts, and run compiler/build evidence.

Verify the skill by using it on a throwaway branch to add one trial recipe that
passes every gate. Merging that trial remains a separate curation decision.
Delete this design document when the accepted starter implementation ships.

## Out of scope

None of the following returns without redrawing the destination:

- a generated Template schema or field-disposition model;
- Item plans, Scaffolding handles, predicates, bindings, transforms, Resolved
  plans, Snippets, a generic field renderer, or a TypeScript AST;
- proactive event-authoring refactoring solely for Scaffolding;
- remote or untrusted recipes, namespaces, authentication, third-party
  execution, a registry directory, or a public Recipe extension API;
- installation tracking, recipe upgrades, reinstallation, AST merging,
  overwrite modes, or multi-file output;
- comprehensive mirrors of every SDK field or mechanical coverage of every
  exposed content registry;
- importing all vanilla documentation or widening every vanilla parser
  independently of an accepted recipe need;
- choosing mod design values for the author;
- general install-backed live completion for leaf references, as recorded by
  [Choose the live-reference catalog and unchecked-mode contract](https://linear.app/unnamed-system/issue/SDK-100/choose-the-live-reference-catalog-and-unchecked-mode-contract).

A declarative catalog becomes a new Wayfinder destination only if remote or
untrusted recipes, data-only third-party authoring, mechanical family-scale
coverage, or demonstrated maintenance failure across a substantially larger
catalog creates evidence for it. One unusual recipe or modest duplicated source
justifies local helpers, not a second programming language.
