import { SDK_DOCS_REVISION } from "../generated/package-version.ts";
import type { Resolved } from "../options.ts";
import { runScript } from "../package-manager.ts";
import { SCAFFOLDER_RELEASE_MANIFEST } from "../release-manifest.ts";

/**
 * The SDK source the scaffold was built from, as the docs site spells it.
 *
 * `SDK_DOCS_REVISION` is a hash of `packages/sdk/src`, computed by the same
 * script for this package and for the documentation site — so the site's
 * `llms.txt` header carries the identical value whenever the two describe the
 * same SDK source. Recording it here is what makes the revision comparison the
 * guidance below asks for possible at all: without it the documentation expert
 * is told to compare against a value the project does not hold.
 */
/**
 * The provenance section, for a project depending on a published SDK.
 *
 * The recorded range is the one the scaffold writes into `package.json`, and
 * the revision is the SDK source this release was built from — so an agent
 * comparing them against the documentation site is comparing two descriptions
 * of the same thing.
 */
const REGISTRY_PROVENANCE = [
  `Scaffolded against \`${SCAFFOLDER_RELEASE_MANIFEST.sdk.packageName}\` ${SCAFFOLDER_RELEASE_MANIFEST.sdk.range}.`,
  "",
  `SDK source revision: \`${SDK_DOCS_REVISION}\``,
  "",
  "The documentation site publishes the same value as its `SDK revision:` line. The two agree exactly when the documentation was generated from the SDK source this project was scaffolded against.",
  "",
  "This is a record of one moment, not a live check. Once `package.json` declares an `@pdx-ts/sdk` version outside the range above, this revision describes an older SDK and the version match governs on its own.",
];

/**
 * The provenance section, for a project scaffolded with `--local`.
 *
 * There is no honest record to write. `package.json` points `@pdx-ts/sdk` at a
 * checkout whose contents are whatever they are now, which is neither the
 * published range this release states nor necessarily the source it was built
 * from — and the checkout keeps changing. Recording the release coordinates
 * anyway would be worse than recording nothing: an agent would compare
 * documentation against a version this project does not depend on, and either
 * reject documentation that matches the checkout or accept documentation for a
 * different API. The CLI already refuses to prove anything about a `file:`
 * dependency, and this says the same thing to the agent.
 */
const LOCAL_PROVENANCE = [
  "Not available. This project depends on a local `@pdx-ts/sdk` checkout through a `file:` link, so there is no published version or fixed source revision to compare documentation against.",
  "",
  "Published documentation describes releases, and a checkout is not one. Treat a version or revision match against it as unproven, say so when it matters to the answer, and prefer the checkout's own source when the two disagree.",
];

const PROVENANCE = (localSdk: string | undefined): string =>
  [
    "## Documentation provenance",
    "",
    ...(localSdk === undefined ? REGISTRY_PROVENANCE : LOCAL_PROVENANCE),
  ].join("\n");

const agentsMdLines = (resolved: Resolved): string[] => [
  "# Agent guidance",
  "",
  "This is an `@pdx-ts/sdk` project that generates a Stellaris mod from TypeScript.",
  "",
  "<!-- pdx-project-collaboration:start -->",
  "## Collaboration agreement",
  "",
  "Status: not configured.",
  "",
  "Before the first substantive project change, read and follow `.agents/skills/pdx-project-startup/SKILL.md` completely. Replace this marked section with the agreed working preferences, then resume the user's original task.",
  "<!-- pdx-project-collaboration:end -->",
  "",
  "## SDK authoring",
  "",
  "Before adding, changing, reorganizing, or diagnosing SDK content, Feature modules, tests, Assets, or the build pipeline, read and follow `.agents/skills/pdx-sdk-authoring/SKILL.md` completely. It owns this project's stable authoring and Feature contract.",
  "",
  "## SDK documentation expert",
  "",
  "Use the project-scoped `pdx-docs-expert` subagent for SDK authoring questions: content fields, localization slots, coverage, scope effects and triggers, testing, and patching vanilla content.",
  "",
  "Invoke it by name. In Codex, spawn one subagent with the `pdx-docs-expert` agent type. In Claude Code, use `@pdx-docs-expert <question>` or ask Claude to use that subagent.",
  "",
  "Start it fresh, without forking or inheriting conversation history. Pass only the documentation question and the explicit project facts needed to answer it. Keep implementation and local verification in the main agent.",
  "",
  "Treat fetched SDK documentation as authoritative only after its declared SDK version matches this project's exact `@pdx-ts/sdk` dependency and its declared SDK revision matches the one recorded below. Generic Stellaris knowledge is not evidence for the SDK authoring surface.",
  "",
  "If the active client cannot use the configured subagent, read and follow `.agents/skills/pdx-sdk-docs/SKILL.md` completely and perform the same documentation retrieval directly.",
  "If current documentation retrieval is blocked, return a concise blocker. Apart from the narrow `package.json` version check, do not inspect the project or substitute repository code or generic Stellaris knowledge for fetched documentation.",
  "",
  PROVENANCE(resolved.localSdk),
  "",
  "## Solar-system diagnostics",
  "",
  `After adding or changing a solar-system initializer, run \`${runScript(resolved.packageManager, "build")}\`. The CLI prints advisory layout warnings and writes an interactive gallery to \`previews/index.html\` with one SVG per initializer.`,
  "",
  "Address each warning deliberately, then inspect the relevant `previews/*.svg` files in a browser. Confirm that stars, planets, moons, orbital lines, and asteroid belts look correct. A clean diagnostic list is not a substitute for visual inspection because the preview uses documented approximations and the diagnostics are advisory.",
  "",
  "## Verification",
  "",
  `Run \`${runScript(resolved.packageManager, "typecheck")}\`, \`${runScript(resolved.packageManager, "test")}\`, and \`${runScript(resolved.packageManager, "build")}\` after code changes. Also run \`${runScript(resolved.packageManager, "lint")}\` when that script exists. A task is complete only when the commands pass and any generated solar-system SVGs have been inspected when relevant.`,
];

const PDX_PROJECT_STARTUP_SKILL =
  [
    "---",
    "name: pdx-project-startup",
    'description: "Establish or revise how an agent collaborates on a create-stellaris-mod project. Use when AGENTS.md\'s Collaboration agreement says `Status: not configured.`, or when the user asks to change that agreement."',
    "---",
    "",
    "# Establishing the collaboration agreement",
    "",
    "The questionnaire is temporary; its result is always-loaded project guidance. Preserve the user's current request while running this setup, replace only the marked Collaboration agreement in `AGENTS.md`, then resume that request without asking the user to repeat it.",
    "",
    "The section begins with `<!-- pdx-project-collaboration:start -->` and ends with `<!-- pdx-project-collaboration:end -->`. Preserve both markers. If the text between them no longer contains `Status: not configured.`, read and follow the configured agreement without restarting setup unless the user asks to revise it.",
    "",
    "## Ask the core questions",
    "",
    "Tell the user briefly that their answers will become the project's agent working agreement. Offer `Use recommended defaults` as a complete answer, and otherwise ask these questions in one concise prompt when the client permits:",
    "",
    "1. **Role:** Should the agent act as an implementer that translates settled ideas into code, a design partner that develops options and recommends one, or a project lead that can flesh out rough concepts?",
    "2. **Creative ownership:** For mechanics and balance, lore and narrative, and localization prose, should the user own it, should the user and agent co-design it, or should the agent draft it? Accept a different answer for each area.",
    "3. **Ambiguity:** Should the agent stop for missing details, present options for consequential choices while making reversible technical choices, or make reasonable creative assumptions and report them?",
    "4. **Communication:** Should responses contain only the result, concise reasoning, or explanations that teach the SDK and implementation?",
    "",
    "The recommended defaults are: design partner with the user making final creative decisions; co-design mechanics, balance, lore, and narrative; draft localization for review; make reversible technical choices; present options for consequential creative choices; suggest adjacent ideas while implementing only agreed scope; give concise reasoning; provide focused in-game checks when playtesting is needed.",
    "",
    "## Ask only relevant follow-ups",
    "",
    "- When the user owns prose, art, or another creative area, ask whether missing input should stop the task, become an explicit placeholder, or receive a temporary labeled draft.",
    "- For a design partner or project lead, ask whether adjacent ideas should only be suggested or may be developed into the current feature.",
    "- When review cadence matters, ask whether the user wants a plan first, reviewable checkpoints, or one completed pass.",
    "- When the agent will help with creative direction, ask for applicable guardrails such as tone, lore fidelity, power level, complexity, compatibility, and subjects it should leave to the user.",
    "- When in-game behavior needs verification, ask whether the user can playtest and whether they want a focused playtest script.",
    "",
    "Ask no follow-up whose answer is already implied. Keep onboarding short enough that it does not replace the task the user came to complete.",
    "",
    "## Write the agreement",
    "",
    "Replace only the text between the collaboration markers with the heading and four to eight concise, normative bullets. Record the resolved preferences, not the questions, choice menus, explanation, or conversation transcript. Include `Per-task instructions override this agreement.` as the final bullet.",
    "",
    "If the user chooses the recommended defaults, write those defaults explicitly. If the user skips the questions, offer to record the recommended defaults so the next agent does not repeat onboarding. If the user declines both the questions and a saved default, write the heading and one bullet stating that startup was declined and agents should follow explicit task instructions, then continue.",
    "",
    "The agreement guides collaboration only. It does not grant standing permission for commits, publishing, destructive operations, external messages, or other actions that need task-specific authority.",
    "",
    "## Recommend optional planning Skills",
    "",
    "After saving the agreement, tell the user about these optional user-invoked Skills from Matt Pocock's Skills plugin:",
    "",
    "- `/grill-with-docs` for a focused mod idea or feature that needs a thorough design interview, shared vocabulary, and recorded decisions.",
    "- `/wayfinder` for a greenfield mod or feature too large to plan in one agent session; it maps unresolved decisions before implementation. Present it as the heavier workflow, not the default for a well-scoped feature.",
    "",
    "Keep this recommendation to a brief two-item note. State that the scaffold does not install these external Skills and that the user can continue without them. If the plugin is unavailable, leave installation as a user-requested follow-up. Then resume the original task.",
    "",
    "Setup is complete when the unconfigured status is gone, every preference the user supplied appears once in the marked block, the optional Skills have been mentioned, and the original task has resumed.",
  ].join("\n") + "\n";

const pdxSdkAuthoringSkillLines = (packageManager: string): string[] => [
  "---",
  "name: pdx-sdk-authoring",
  "description: Author and modify an @pdx-ts/sdk Stellaris mod project. Use when adding or reorganizing Feature modules, shared authoring values, tests, Assets, or build-pipeline customization, or when diagnosing the feature list, capability ownership, placement, references, or output identity.",
  "---",
  "",
  "# Authoring an @pdx-ts/sdk project",
  "",
  "Use this Skill for the stable project and Feature contract. Use the project-scoped `pdx-docs-expert` from `AGENTS.md` for the exact generated authoring surface: content fields, localization slots, registry coverage, scope effects and triggers, patching, testing APIs, and working content examples.",
  "",
  "## Mental model",
  "",
  "This project is a TypeScript program that runs once at build time and emits an ordinary Stellaris mod. The game receives PDXScript, localization, metadata, and Asset files; it never runs the TypeScript.",
  "",
  "- `mod` is the immutable authoring capability bound to this project's prefix.",
  "- Capability methods create typed **Items**: definitions, events, on-action contributions, localization, patches, and Assets.",
  "- A **Feature** explicitly selects Items for the build and gives per-Feature outputs an authored file stem. Importing or exporting an Item does not select it.",
  "- `mod.compile(features)` is the **Fold**. It validates the selected Features, assigns logical output paths, and produces one immutable mod value before rendering or disk writes.",
  "",
  "## Project contract",
  "",
  "- Treat `stellaris-mod.json` as the source of truth for mod identity, launcher metadata, and the Asset tree. Its sole key under `mod` is the prefix.",
  "- Import `mod` and `config` from `#mod`. The package import alias keeps Feature modules independent of their source depth. `buildTheMod` lives in `src/build.ts`, the one module that imports both `#mod` and the feature list.",
  '- `src/features.ts` is the feature list: one `export { feature as <name> } from "./features/<module>.ts";` line per Feature. `createModProject` constructs the capability without reading source; `src/build.ts` imports the list as a namespace and passes it to `project.build(features)`, which captures the optional Asset tree and performs one Fold over exactly the Features the list declares.',
  "- Compose `mod.assetTree` and `mod.compile` directly only when the project needs a different pipeline.",
  `- \`${runScript(packageManager, "inspect")}\` performs the same Fold without writing the mod and prints deterministic YAML. Use it to review Feature stems, Item counts and ids, patch plans, warnings, dependency versions, and vanilla evidence.`,
  "",
  "## Feature contract",
  "",
  "- Organize source around concepts maintained together. One Feature may coordinate Items from several registries; the Fold fans them out to the directories Stellaris expects.",
  "- Add a Feature by writing a module under `src/features/` that exports exactly one named, stemmed `feature`, and by exporting that `feature` from `src/features.ts` under a unique name. Only that line puts a module in the mod; importing or exporting an Item elsewhere does not select it. Other named and default exports of a feature module are ordinary module API.",
  "- Keep a Feature's private helpers under `src/features/<name>/`, and values several Features share directly under `src/`. Neither needs a line in `src/features.ts`; a helper is reached through the Feature that imports it.",
  "- Pass one Item module namespace to `mod.feature`, or pass a shallow array that mixes Items and module namespaces. A namespace contributes only its Item-valued exports. Use module exports, not nested arrays, for deeper organization.",
  `- \`${runScript(packageManager, "lint")}\` runs knip, which reports any module under \`src/\` that no entry point reaches. A feature module the list does not declare is reported by path; declare it or delete it.`,
  "- Use a lowercase `snake_case` Feature stem with no `/`. The stem controls per-Feature output filenames; the source filename and directory do not become content identity.",
  "- Place only Items created by this project's `mod` in its Features. Every authored Item referenced by selected content must also belong to a selected Feature, or the Fold reports a dangling reference.",
  "- Keep one event namespace in one Feature. Keep its handle inside that Feature's own files, never exported from `src/features.ts` or to another Feature, and place its events and firing hooks in that Feature.",
  "",
  "## References and identity",
  "",
  "- When a content method takes a logical name, pass only that logical name. The capability mints its full id from the project prefix, registry, and logical name. Use the docs expert to identify nested fields that require a complete authored id.",
  "- Pass authored Item values as cross-content references so TypeScript and the Fold retain their registry and ownership information.",
  "- Prefer checked `vanilla.*` references and generated scripted bindings for content supplied by Stellaris. Use raw strings deliberately for third-party content the checked vanilla package cannot contain.",
  "",
  "## Authoring sequence",
  "",
  "1. Read `stellaris-mod.json`, `src/features.ts`, the package scripts, and the nearest existing Feature before deciding placement. This step is complete when the prefix, the declared Features, the current Feature boundary, and the available verification commands are known.",
  "2. Ask the docs expert for every exact content method, field, localization slot, scope operation, or coverage decision the change needs. This step is complete when each SDK call is supported by version-matched documentation; generic Stellaris knowledge is context, not SDK API evidence.",
  "3. Create Items through `mod`, preserve returned values for references, and group the Items that ship together. This step is complete when every intended Item is reachable from one selected Feature and every authored reference target is selected too.",
  `4. Export exactly one named \`feature\` from each feature module and declare it in \`src/features.ts\`. Keep reusable sibling exports ordinary and keep helpers out of the list. This step is complete when every intended Feature has its line in the list and \`${runScript(packageManager, "lint")}\` reports no unreachable module.`,
  "5. Add or update colocated tests when the SDK test interpreter models the changed behavior. Treat its unsupported-semantics refusal as a limit of the harness rather than evidence about the game.",
  `6. Run \`${runScript(packageManager, "inspect")}\` and the verification required by \`AGENTS.md\`. Address every build error and warning deliberately, and inspect generated previews when that guidance requires it. The change is complete when those gates pass and the YAML report places every intended id under the expected Feature.`,
];

const PDX_SDK_DOCS_SKILL =
  [
    "---",
    "name: pdx-sdk-docs",
    "description: Retrieve @pdx-ts/sdk documentation from its docs site as plain Markdown. Use when authoring Stellaris mod content with the SDK and you need a content type's fields, localization slots, or a working example; when checking whether the SDK can author a game concept at all; when looking up the effect and trigger methods a scope exposes; or for workflow guides such as the pipeline, testing, and patching vanilla.",
    "---",
    "",
    "# Retrieving @pdx-ts/sdk docs",
    "",
    "Base URL: `https://pdx-ts-sdk-docs-site.vercel.app`",
    "",
    "The tables and examples are generated from the SDK itself. Answer from the fetched page, not from prior Stellaris modding knowledge: vanilla script conventions and the SDK's authoring surface differ.",
    "",
    "## Process",
    "",
    "1. Fetch `{BASE}/llms.txt`. Every page is one line: `[Title](twin-url): description`. Pick the page whose description covers the need.",
    "2. Fetch the linked twin at `{BASE}/llms.mdx/<path>/content.md`. This is the page as Markdown. Reference pages contain the complete field tables, localization slots, and paired examples: the TypeScript lesson and the PDXScript it renders.",
    "3. When no index description identifies the answer for a specific field, method, or game key, download `{BASE}/llms-full.txt` once to a temporary file and search it. Each page starts with `# Title (/its/path)`, so a hit maps to `{BASE}/llms.mdx/its/path/content.md`. Fetch that twin for full context.",
    "",
    "## Reading reference pages",
    "",
    "- For whether the SDK can author a concept, use `{BASE}/llms.mdx/reference/coverage/content.md`. It lists every registry with its authoring call and game folder, non-registry channels, and concepts not yet supported.",
    "- A game field omitted from the authoring surface appears under `Fields the SDK does not author` on its page, with the reason. A field absent from both the tables and that list is a documentation gap worth reporting, not evidence that an undocumented form works.",
  ].join("\n") + "\n";

const PDX_DOCS_EXPERT_POLICY = [
  "You are the documentation expert for `@pdx-ts/sdk`, a TypeScript SDK for generating Stellaris mods. Answer questions strictly from the SDK's published documentation, which you retrieve fresh for every question.",
  "",
  "Before answering, read and follow `.agents/skills/pdx-sdk-docs/SKILL.md` completely. It defines the documentation index, Markdown twins, full-corpus search, and base URL. Follow that retrieval process instead of improvising URLs.",
  "",
  "## Mandate",
  "",
  "- Ground every answer in pages fetched during this task. The SDK authoring surface differs from raw Stellaris script: members are camelCase, some game fields are intentionally unsupported, and localization works through slots. Generic Stellaris knowledge may help interpret a question, but it is not answer evidence.",
  "- Prefer a specific page over a full-corpus search. For a content-authoring question, fetch the relevant reference twin and read it completely. Search the full corpus only when the index does not identify the page for a field, method, or game key.",
  "- Treat absence as an answer. For a missing concept, check the coverage page. For a missing field, check the page's `Fields the SDK does not author` section. If neither documents it, state that plainly and suggest reporting the documentation gap. Do not guess an undocumented spelling.",
  "- Keep a strict evidence boundary. Other than the narrow `package.json` dependency-version check, repository paths, installed game files, mod source, and implementation details in the request describe the use-case only. Answer from version-matched published documentation and give the coordinator a short `Local verification needed` list for facts the docs cannot establish. Do not inspect repository or game files.",
  "- Treat generated identities as prefix-dependent. Use an exact mod prefix only when the request supplies it. Otherwise write formulas such as `<prefix>_<namespace>.<number>` and label any illustrative prefix as an example, not a project fact.",
  "- The only filesystem write you may make is a temporary `llms-full.txt` cache under the operating-system temporary directory when full-corpus grep is required. Create a dedicated temporary directory, remove the cache with `unlink`, and remove the empty directory with `rmdir` before responding; do not use recursive deletion. Leave no cache in the project. Do not edit the project, user files, user configuration, or external systems. Do not spawn other agents.",
  "",
  "## Answer shape",
  "",
  "Complete the retrieval before responding, then return exactly one consolidated report. Do not stream partial findings. If retrieval is blocked, return one concise blocker report instead.",
  "",
  "Use this order:",
  "",
  "1. `Direct answer`: the authoring call, relevant members, types, and the smallest useful excerpt from the paired example.",
  "2. `Assumptions and local verification`: required members, localization slots, cautions, prefix assumptions, and facts the documentation cannot establish.",
  "3. `Sources`: direct links to every published page used.",
  "",
  "Keep the answer complete and lean. Cover the question, not the whole page.",
].join("\n");

const CLAUDE_AGENT =
  [
    "---",
    "name: pdx-docs-expert",
    "description: Documentation-only @pdx-ts/sdk expert that retrieves published docs and returns one concise, cited authoring report without inspecting repositories or game files.",
    "tools: Bash, WebFetch, Read, Grep",
    "model: sonnet",
    "effort: medium",
    "permissionMode: acceptEdits",
    "skills:",
    "  - pdx-sdk-docs",
    "---",
    PDX_DOCS_EXPERT_POLICY,
  ].join("\n") + "\n";

const CODEX_AGENT =
  [
    'name = "pdx-docs-expert"',
    'description = "Documentation-only @pdx-ts/sdk expert that retrieves published docs and returns one concise, cited authoring report without inspecting repositories or game files."',
    'model = "gpt-5.6-luna"',
    'model_reasoning_effort = "medium"',
    'sandbox_mode = "workspace-write"',
    'developer_instructions = """',
    PDX_DOCS_EXPERT_POLICY,
    '"""',
    "",
    "[sandbox_workspace_write]",
    "network_access = true",
    "exclude_slash_tmp = false",
    "exclude_tmpdir_env_var = false",
  ].join("\n") + "\n";

export function agentsMd(resolved: Resolved): string {
  return `${agentsMdLines(resolved).join("\n")}\n`;
}

/** Returns the one-time collaboration setup Skill shared by Codex and Claude. */
export function pdxProjectStartupSkill(): string {
  return PDX_PROJECT_STARTUP_SKILL;
}

/** Returns the project-local authoring Skill shared by Codex and Claude. */
export function pdxSdkAuthoringSkill(resolved: Resolved): string {
  return `${pdxSdkAuthoringSkillLines(resolved.packageManager).join("\n")}\n`;
}

export function pdxSdkDocsSkill(): string {
  return PDX_SDK_DOCS_SKILL;
}

export function claudeAgent(): string {
  return CLAUDE_AGENT;
}

export function codexAgent(): string {
  return CODEX_AGENT;
}
