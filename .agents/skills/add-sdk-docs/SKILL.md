---
name: add-sdk-docs
description: User-invoked workflow in which the coordinator launches research subagents and writes documentation for a registry item.
---

# Add SDK Docs

Stellaris is installed at `/Users/jackson/Library/Application Support/Steam/steamapps/common/Stellaris`.

Write user-facing documentation for a registry item (technologies, buildings, megastructures, etc). These tasks will differ from normal Linear tickets. Instead of delegating the writing to a subagent, write the doc content yourself.

Process:

1. Gather relevant context for the page using `researcher` agents.
2. Write the documentation content.
3. The user will review.
4. You will commit changes when the work is complete.

You may end up creating multiple documentation pages in a single session, so don't open a PR until the user asks.

## Registry Content

These instructions are for writing content that lives in `packages/docs-site/content/docs/reference`. Do not follow them for Tutorials or Guides.

First, check `packages/docs-site/complexity.md`.

- Highly complex registry items should be researched thoroughly. The page should include multiple examples, best practices, and gotchas. Make sure to read multiple Vanilla examples in full before writing and trace how they're used. If the registry item has a complex field (such as swaps, stages, or is composed of multiple components) make sure there are subsections for each.
- Moderately complex registry items should be researched in detail. The page should include a simple and a bells-and-whistles example. Similar to the above, make sure to create subsections for complex fields.
- Simple registry items can follow a standard template: what the concept is in game terms + its game folder; minimal paired example; one or two notable examples (the editorial call per page); generated field table; patch section only where patchable; links to the Def type and the registry's vanilla ids.

Each Reference page must include the `<FieldTable />` component.

## Writing Tutorials

These instructions are for writing content that lives in `packages/docs-site/content/docs/tutorials`.

When writing tutorials, never create a trivial example. Search vanilla Stellaris content for non-trivial examples and then rewrite them, changing them to be distinct from vanilla. Never reproduce Stellaris content directly for licensing reasons. Make sure to read the full content of inline scripts since they usually hide complex implementation details.

It's easier for the end user to rip out content they don't need from a detailed example than it is for them to add additional content to a bare-bones example.

When finished writing the tutorial, add links to it in the relevant Reference pages.

### Structure

```md
## Overview

Short description of what we're building.

## End Result

PairedExample with the end result.

## Step-By-Step Instructions

Use the Steps component and TypeScript code blocks.

## Further Reading & Notes

Links to related documentation and helpful pointers.
```

### Steps

Use the following syntax for step-by-step instructions:

```mdxjs
import { Step, Steps } from '@/src/components/steps';

<Steps>
  <Step>

    ### Hello World

    This is some content.

  </Step>

  <Step>

    ### Hello World

  </Step>
</Steps>
```

## Fact-Checking

Before claiming a page is complete, launch a `doc-fact-checker` subagent to go through the page line by line and fact check. When it reports back, verify its claims and make the necessary repairs.
