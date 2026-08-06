# Scaffolding

Turning generated field knowledge and curated Stellaris conventions into
TypeScript source a mod author owns. This context borrows **Feature** and
**Item** from Authoring and owns the vocabulary for recipes that emit them.

See the [context map](../../CONTEXT-MAP.md) for how generated facts and authored
source cross this context's boundaries.

## Language

**Recipe Catalog**:
The built-in, discoverable set of parameterized recipes available to the
scaffolder.
_Avoid_: recipe registry, block registry

**Item recipe**:
A catalog recipe that emits one Authoring Feature containing exactly one Item.
_Avoid_: definition generator, primitive

**Feature recipe**:
A catalog recipe that emits one Authoring Feature containing multiple
coordinated Items.
_Avoid_: block, template

**Recipe topology**:
The curated structure describing which Items a feature recipe coordinates and
which answers they share, distinct from mechanically generated field facts.
