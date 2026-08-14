# Authoring Reference

Assembling versioned contributions from the repository's source-of-truth
contexts into an offline, read-only guide to the SDK's authoring model. It owns
documentation claims and presentation, never legality, recipe topology, or
game evidence.

See the [context map](../../CONTEXT-MAP.md) for the one-way boundaries from CWT
Codegen and Scaffolding.

## Language

**Generated authoring reference**:
The author-facing guide organized to help a TypeScript author reach a working
Feature. It documents the SDK's authoring contract rather than attempting to
document raw Stellaris modding.
_Avoid_: API dump, general Stellaris documentation, second schema

**Reference contribution**:
A committed, deterministic, producer-owned documentation artifact consumed when
assembling a Reference build. It is reviewed with the source facts or guidance
it projects, and the producing context never reads the assembled build back.
_Avoid_: shared documentation model, implementation import

**Reference claim**:
One author-facing statement with a stable subject, claim status, and
provenance. Claims distinguish contracts, observations, curation, and gaps
rather than flattening them into undifferentiated prose.

**Supported contract**:
A Reference claim guaranteed by the current generated Authoring surface or its
build-time checks. Stronger than an Observed example or Curated convention.

**Observed example**:
A Reference claim that a specific game source or corpus exemplar uses a form.
It is evidence that the form occurs, not a guarantee that it is generally legal
or a recommendation to authors.

**Unresolved behavior**:
A game behavior for which the available rules, documentation, corpus, or oracle
evidence does not support a reliable claim. The reference preserves the gap
rather than guessing.

**Known omission**:
A game or rule construct that the SDK deliberately declines or does not yet
support, with its disposition and reason preserved for authors. Mere absence
from the Supported authoring model is not a Known omission.
_Avoid_: missing field, unsupported by inference

**Reference build**:
One immutable Generated authoring reference together with the exact SDK, CWT,
game-documentation, corpus, and vanilla-identifier versions that support its
claims. Its viewer assets and search index are derived package outputs rather
than committed contributions; evidence from different builds is never
presented as one timeless view.
_Avoid_: latest docs, live knowledge base

**Authoring reference app**:
The offline, read-only local viewer for one Reference build. It supports
discovery and lookup without inspecting or changing an author's project.
_Avoid_: hosted documentation site, project analyzer, editor

**Reference spike**:
A bounded experiment testing whether a real Reference contribution,
dependency-checked curation, and a Verified example can teach one representative
SDK capability without duplicating legality or hiding uncertainty. It must
include a semantic change that proves stale guidance or projection drift fails.
Its implementation is quarantined from product packages and is never promoted
in place; a successful result informs a separate implementation.
_Avoid_: UI prototype, miniature documentation site, experimental product code

**Codegen probe**:
The Reference spike's single quarantined reader of CWT Codegen internals. It
immediately refines those facts into a spike-owned value and proves only that a
useful contribution can be derived, never that the probe is a production
boundary.
_Avoid_: Reference contribution, public adapter, codegen interface

**Install audit**:
An evidence pass over a matching local Stellaris install that produces only
sanitized observations, counts, versions, and hashes. It can strengthen an
Observed example but is never required to build or run a Reference build and
does not establish a Supported contract by itself.
_Avoid_: runtime dependency, committed game source, oracle run
