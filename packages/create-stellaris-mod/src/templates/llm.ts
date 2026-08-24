import { SDK_DOCS_REVISION } from "../generated/package-version.ts";

const AGENTS_MD =
  [
    "# Agent guidance",
    "",
    "This is an `@pdx-ts/sdk` project that generates a Stellaris mod from TypeScript.",
    "",
    "## Project rules",
    "",
    "- Treat `stellaris-mod.json` as the source of truth for mod identity, launcher metadata, and source layout.",
    "- Import `mod`, `config`, and `buildTheMod` from `#mod`. Do not compute a relative path to `src/mod.ts`.",
    "- A selected module under the manifest's `contentDirectory` exports exactly one named `feature`. Source layout is not content identity.",
    "- Use the generated SDK surface for game semantics. Unsupported semantics should stay visible instead of being guessed.",
    "",
    "## SDK documentation expert",
    "",
    "Use the project-scoped `pdx-docs-expert` subagent for SDK authoring questions: content fields, localization slots, coverage, scope effects and triggers, testing, and patching vanilla content.",
    "",
    "Invoke it by name. In Codex, spawn one subagent with the `pdx-docs-expert` agent type. In Claude Code, use `@pdx-docs-expert <question>` or ask Claude to use that subagent.",
    "",
    "Start it fresh, without forking or inheriting conversation history. Pass only the documentation question and the explicit project facts needed to answer it. Keep implementation and local verification in the main agent.",
    "",
    "Treat fetched SDK documentation as authoritative only after its declared SDK version matches this project's exact `@pdx-ts/sdk` dependency and its SDK source revision matches this scaffold. Generic Stellaris knowledge is not evidence for the SDK authoring surface.",
    "",
    "If the active client cannot use the configured subagent, read and follow `.agents/skills/pdx-sdk-docs/SKILL.md` completely and perform the same documentation retrieval directly.",
    "If current documentation retrieval is blocked, return a concise blocker. Apart from the narrow `package.json` version check, do not inspect the project or substitute repository code or generic Stellaris knowledge for fetched documentation.",
    "",
    "## Solar-system diagnostics",
    "",
    "After adding or changing a solar-system initializer, run `npm run build`. The CLI prints advisory layout warnings and writes an interactive gallery to `previews/index.html` with one SVG per initializer.",
    "",
    "Address each warning deliberately, then inspect the relevant `previews/*.svg` files in a browser. Confirm that stars, planets, moons, orbital lines, and asteroid belts look correct. A clean diagnostic list is not a substitute for visual inspection because the preview uses documented approximations and the diagnostics are advisory.",
    "",
    "## Verification",
    "",
    "Run `npm run typecheck`, `npm test`, and `npm run build` after code changes. Also run `npm run lint` when that script exists. A task is complete only when the commands pass and any generated solar-system SVGs have been inspected when relevant.",
  ].join("\n") + "\n";

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
  ].join("\n") + "\n";

const CODEX_AGENT =
  [
    'name = "pdx-docs-expert"',
    'description = "Documentation-only @pdx-ts/sdk expert that retrieves published docs and returns one concise, cited authoring report without inspecting repositories or game files."',
    'model = "gpt-5.6-luna"',
    'model_reasoning_effort = "medium"',
    'sandbox_mode = "workspace-write"',
    'developer_instructions = """',
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
    '"""',
    "",
    "[sandbox_workspace_write]",
    "network_access = true",
    "exclude_slash_tmp = false",
    "exclude_tmpdir_env_var = false",
  ].join("\n") + "\n";

export function agentsMd(): string {
  return AGENTS_MD;
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
