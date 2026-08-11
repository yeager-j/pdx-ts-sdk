# Scaffolding

Turning curated Stellaris conventions into TypeScript source a mod author
owns, proven against the generated Authoring surface. This context borrows
**Feature** and **Item** from Authoring and owns the vocabulary for recipes
that emit them.

See the [context map](../../CONTEXT-MAP.md) for how the typed Authoring surface
and authored source cross this context's boundaries.

## Language

**Project Manifest**:
The author-owned source of truth for one project's mod identity, launcher metadata, and Feature
source location. It is project configuration, not scaffolder installation state.
_Avoid_: scaffolding config, mod config file, installation record

**Project Layout**:
The parsed, normalized placement contract derived from the Project Manifest. Feature source lives
below `src/`; recipe publication, generated discovery wiring, and TypeScript project coverage all
consume that same interpretation.

**Recipe Catalog**:
The built-in, discoverable set of parameterized recipes available to the
scaffolder.
_Avoid_: recipe registry, block registry

**Item recipe**:
A catalog recipe that emits one Authoring Feature containing exactly one Item.
It may ask no intent questions when a curated working starter needs no
structural choice from the author.
_Avoid_: definition generator, primitive

**Feature recipe**:
A catalog recipe that emits one Authoring Feature containing multiple
coordinated Items.
_Avoid_: block, template

**Recipe**:
A trusted built-in Recipe Catalog entry containing discovery metadata, a finite set
of Intent questions, and one Recipe renderer.
_Avoid_: recipe policy, registry entry, declarative plan

**Recipe renderer**:
The recipe-owned pure function from derived names and validated answers to one
Generated Feature Source. It owns the source's imports, topology, callbacks,
references, comments, and Feature assembly.
_Avoid_: generic renderer, template engine, field walker

**Generated Feature Source**:
The deterministic, single-file TypeScript source a Recipe renderer returns
before dry-run presentation or exclusive publication. It becomes wholly
author-owned once written.
_Avoid_: resolved plan, render input, generated artifact

**Recipe topology**:
The curated structure describing which Items a feature recipe coordinates and
which answers they share. It lives in the Recipe renderer rather than being
inferred from field legality.

**Curated starter**:
A short, working source pattern that demonstrates the conventional structure
of one Item or Feature without mirroring every optional SDK input.
_Avoid_: comprehensive template, generated API

**Measured evidence**:
A frequency or co-occurrence observation from the committed corpus. It ranks
and informs curation but never decides a branch, default answer, or
recommendation, and no artifact binds to it at generate time.
_Avoid_: corpus stats, usage data

**Curated convention**:
A maintainer judgment recorded in a Recipe — which structural choices become
Intent questions, each question's Default answer, the Curated starter's
contents, and author-facing explanations — justified by documentation,
exemplars, or Measured evidence and cited informally in catalog source.
_Avoid_: best practice, opinionated default

**Default answer**:
The curated answer an Intent question resolves to under `--yes` or non-TTY
operation: the most conventional branch per the evidence, with simplest
structure breaking ties or applying where evidence is silent.
_Avoid_: fallback, auto answer

**Intent question**:
A finite-choice generator question whose answer changes Item topology,
authoring kind, scope contract, block structure, control flow, or cross-Item
references. Leaf values that are easier to edit in source are not Intent
questions.
_Avoid_: field prompt, form question
