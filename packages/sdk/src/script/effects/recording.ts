/**
 * The recording lifecycle behind the effect recorder: the stack of blocks
 * being recorded into, the liveness of a recording, and the leases that bind
 * one authoring call's values to that call.
 *
 * The dispatch that records into these blocks lives in `recorder.ts`.
 */

import type { PdxEntry } from "@pdx-ts/pdxscript";

import type { ContentRefUse } from "../../references.ts";
import type { RecordingState } from "./structural.ts";

/**
 * One authoring call's identity — one `withScriptCtx` body, which is one
 * definition's or event's lowering.
 *
 * The ctx that call hands out carries its lease, and so does every recording
 * opened while it runs. Comparing the two is how {@link assertOwnedBy} tells a
 * ctx used where it was given from one that escaped into another definition.
 */
export type ScriptLease = symbol;

/** The authoring calls currently running, innermost last. */
const LEASES: ScriptLease[] = [];

/**
 * Runs `body` under a fresh lease and hands that lease over, so the values the
 * call gives out can be stamped with it. Recordings opened while the body runs
 * take this lease unless they inherit an owner's.
 */
export function withLease<T>(body: (lease: ScriptLease) => T): T {
  const lease: ScriptLease = Symbol("scriptCtx");
  LEASES.push(lease);
  try {
    return body(lease);
  } finally {
    LEASES.pop();
  }
}

/**
 * The block effects are being recorded into, innermost first.
 *
 * A ref opens a block relative to wherever the author is writing — `from = { }`
 * inside `every_owned_ship = { }` runs once per ship, and at the top level once
 * — so `effects` needs the *lexically* enclosing block, not the one whose scope
 * object happens to be in a variable. Recording is synchronous and eager
 * (closures run inside `define`), so the innermost live recording is exactly
 * that block.
 */
export interface Recording extends RecordingState {
  readonly sink: PdxEntry[];
  readonly refs: ContentRefUse[];
  /**
   * False once {@link closeRecording} has popped this recording — the closure
   * returned, and its entries are finished data the caller has already put in
   * a block. The scope object handed to that closure keeps a reference to the
   * sink, so an author who stores it somewhere outliving the closure can still
   * reach it; every dispatch path of the scope object checks this flag so that
   * reaches {@link assertLive} instead of the sink.
   */
  live: boolean;
  /**
   * The authoring call this recording was opened under, or `undefined` for a
   * recording started outside one. A leased ctx ref may only be opened here
   * when the two leases match.
   */
  readonly lease: ScriptLease | undefined;
}

const RECORDINGS: Recording[] = [];

/**
 * Opens a recording over `sink` and makes it the innermost one, under the
 * owner's lease when it has one and under the innermost running authoring
 * call's otherwise. Every call pairs with {@link closeRecording}.
 */
export function openRecording(
  owner: Recording | undefined,
  sink: PdxEntry[],
  refs: ContentRefUse[]
): Recording {
  const recording: Recording = {
    sink,
    refs,
    live: true,
    lease: owner === undefined ? LEASES.at(-1) : owner.lease,
  };
  RECORDINGS.push(recording);
  return recording;
}

/**
 * Pops `recording` and marks it dead.
 *
 * Call it from a `finally`: an author's error inside one closure must not
 * leave every later closure recording into a dead block. Marked dead for the
 * same reason it is popped — the entries are finished either way, so a scope
 * object that outlived the closure must not reach them.
 */
export function closeRecording(recording: Recording): void {
  RECORDINGS.pop();
  recording.live = false;
}

/**
 * Refuses a call on a scope object whose closure has already returned.
 *
 * Without this the call succeeds: the entry lands in an array `block()` stored
 * by reference, so a `PureMod` that `buildMod` already froze and returned
 * renders different bytes on the *next* `render` — a build with no error and
 * no symptom until someone compares two renders. `undefined` is the
 * `makeScope` seam, whose caller owns the sink it passed in and so has no
 * closure to escape from.
 */
export function assertLive(recording: RecordingState | undefined, member: string): void {
  if (recording === undefined || recording.live) {
    return;
  }
  throw new Error(
    `'${member}' was called on a scope object whose effect closure has already returned, so ` +
      "there is no longer a block for its entries to land in. The closure's entries were " +
      "finished and handed to the caller when it returned; recording into them now would " +
      "change what an already-built mod renders, silently and only on the next render(). " +
      "Record every effect inside the closure that receives the scope — a definition's " +
      "effect field, an event's immediate/after/option — rather than storing the scope " +
      "object and using it later."
  );
}

/** The innermost recording, or a throw naming `path` when there is none. */
export function activeRecording(path: string): Recording {
  const recording = RECORDINGS.at(-1);
  if (recording === undefined) {
    throw new Error(
      `'${path}' was opened with .effects() outside any effect closure, so there is no ` +
        "block for its entries to land in. Call it inside the closure that should contain " +
        "it — a definition's effect field, an event's immediate/after/option — rather than " +
        "storing the result and using it later."
    );
  }
  return recording;
}

/**
 * Whether `lease` came from an authoring call other than the one `recording`
 * belongs to.
 *
 * A ctx is handed to one definition's closures, and `root` and `from` mean
 * whatever that definition's rules say they hold; used against another
 * definition's recording, they still write, under scopes the game supplies
 * from that definition's rules instead. A value with no lease is reusable by
 * contract — an event target names its scope absolutely — and is never an
 * escape. Each site states its own harm, since what a ctx path writes differs
 * between opening a block and witnessing an event fire.
 */
export function hasEscaped(recording: Recording, lease: ScriptLease | undefined): boolean {
  return lease !== undefined && recording.lease !== lease;
}

/** Refuses to open a ctx ref inside another authoring call's recording. */
export function assertOwnedBy(
  recording: Recording,
  lease: ScriptLease | undefined,
  path: string
): void {
  if (!hasEscaped(recording, lease)) {
    return;
  }
  throw new Error(
    `'${path}' was opened with .effects() from a ScriptCtx belonging to a different ` +
      "definition, so the context escaped the closure it was handed to. Its entries would " +
      `land in this recording as a '${path}' block while keeping the FROM and ROOT scopes ` +
      "of the definition the context came from — scopes the game does not supply here. Use " +
      "the ctx the closure being written receives, rather than one kept from an earlier one."
  );
}

/**
 * SDK-internal: refuses a recording closure that returned a promise.
 *
 * `(scope) => void` accepts an `async` function — TypeScript allows any return
 * type where `void` is expected — and the return value used to be discarded,
 * so an author who wrote `async` got a mod that built cleanly and was quietly
 * wrong: everything before the first `await` recorded, the recording ended
 * when the closure returned at that `await`, and everything after it either
 * vanished or (since recorders die with their recording) threw into a floating
 * promise as an unhandled rejection. Neither failed the build.
 *
 * Callers check *after* closing their recording, so a throw here cannot leave
 * one open. Thenable rather than `instanceof Promise`, so a non-native promise
 * is caught too; anything else a closure happens to return is ignored, since
 * returning a value from a void-typed closure is harmless and common
 * (`(s) => s.log("x")` returns whatever `log` returns).
 *
 * The abandoned promise is *observed* before the throw, because refusing it is
 * not the same as containing it. Its continuation still runs, still reaches
 * for a recorder that is now dead, and still rejects — with nothing attached,
 * that is an `unhandledRejection`, which by default terminates the process.
 * A caller who catches the build error this throws would have had their
 * process killed anyway, moments later, by the very failure they caught. The
 * no-op handler makes this diagnostic the whole of the failure.
 */
export function assertSynchronousClosure(result: unknown, subject: string): void {
  if (
    result === null ||
    (typeof result !== "object" && typeof result !== "function") ||
    typeof (result as { then?: unknown }).then !== "function"
  ) {
    return;
  }
  // `Promise.resolve` adopts the thenable rather than calling `then` here, so
  // a thenable that misbehaves — throwing from `then`, resolving twice —
  // rejects this wrapper instead of escaping, and the wrapper is handled.
  void Promise.resolve(result as PromiseLike<unknown>).catch(() => {});
  throw new Error(
    `${subject} returned a promise, which means it was declared \`async\` or returned a ` +
      "thenable. Authoring is recorded synchronously: the recording ended the moment the " +
      "closure returned at its first `await`, so only what was recorded before that await was " +
      "captured, and anything after it is silently lost or throws where nothing can catch it. " +
      "Do the asynchronous work before authoring — await it, then pass the result into the " +
      "definition — and keep the closure itself synchronous. A recording closure describes " +
      "what the game should do; it never waits for anything at build time."
  );
}
