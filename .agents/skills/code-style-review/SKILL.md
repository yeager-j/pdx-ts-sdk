---
name: code-style-review
description: Use the `code-style` Skill to find issues with a section of code.
---

# Code Style Review

Always do this work in two phases.

## Phase 1: Locate Faults

Start by using the `code-style` Skill and note each rule's **diagnostics**. Go through the section
of code provided by the user (such as a function, a file, or a folder) and find issues that meet
the diagnostic threshold. Be thorough and be bold; don't hesitate to suggest a challenging refactor
of a large function or set of functions if they meet the diagnostic threshold.

Make a list of these findings.

## Phase 2: Fix Faults

Go through your list of findings and begin fixing. Use the same `code-style` Skill to guide you
on the best way to write that piece of code.
