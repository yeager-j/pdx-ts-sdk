#!/usr/bin/env node
/**
 * The executable entry, kept separate from `cli.ts` for one reason: `cli.ts`
 * must be importable without running anything, so the tests can call `main`
 * in-process. A module that both exports `main` and calls it cannot be tested
 * that way.
 */
import { main } from "./cli.ts";

process.exitCode = await main(process.argv.slice(2));
