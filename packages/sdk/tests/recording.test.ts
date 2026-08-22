import { describe, expect, it } from "vitest";

import {
  activeRecording,
  assertLive,
  assertSynchronousClosure,
  closeRecording,
  openRecording,
  withLease,
} from "../src/script/effects/recording.ts";

// The recorder's tests exercise these rules through authored effects. Here the
// primitives are driven directly, so a lifecycle mistake names itself instead
// of surfacing as a wrongly nested block somewhere in the emitted script.
describe("the recording stack", () => {
  it("returns to the enclosing recording when the inner one closes", () => {
    const outer = openRecording(undefined, [], []);
    const inner = openRecording(outer, [], []);
    expect(activeRecording("inner")).toBe(inner);

    closeRecording(inner);
    expect(activeRecording("outer")).toBe(outer);

    closeRecording(outer);
    expect(() => activeRecording("from")).toThrow(/outside any effect closure/);
  });

  it("marks a closed recording dead, so its scope object refuses later members", () => {
    const recording = openRecording(undefined, [], []);
    expect(() => assertLive(recording, "log")).not.toThrow();

    closeRecording(recording);
    expect(() => assertLive(recording, "log")).toThrow(/already returned/);
  });

  it("has no liveness to check where there is no recording", () => {
    // The makeScope seam: the caller owns the sink, so there is no closure for
    // a scope object to outlive.
    expect(() => assertLive(undefined, "log")).not.toThrow();
  });
});

describe("authoring-call leases", () => {
  it("stamps a recording with the innermost call running, and none outside one", () => {
    withLease((outerLease) => {
      const underOuter = openRecording(undefined, [], []);
      expect(underOuter.lease).toBe(outerLease);
      closeRecording(underOuter);

      withLease((innerLease) => {
        expect(innerLease).not.toBe(outerLease);
        const underInner = openRecording(undefined, [], []);
        expect(underInner.lease).toBe(innerLease);
        closeRecording(underInner);
      });
    });

    const unleased = openRecording(undefined, [], []);
    expect(unleased.lease).toBeUndefined();
    closeRecording(unleased);
  });

  it("gives a recording its owner's lease rather than the call now running", () => {
    // One definition authored inside another's live closure: the block belongs
    // to the tree its sink is in, not to whichever call is on the stack.
    const owner = withLease((lease) => {
      const recording = openRecording(undefined, [], []);
      expect(recording.lease).toBe(lease);
      return recording;
    });

    withLease((otherLease) => {
      const nested = openRecording(owner, [], []);
      expect(nested.lease).toBe(owner.lease);
      expect(nested.lease).not.toBe(otherLease);
      closeRecording(nested);
    });

    closeRecording(owner);
  });

  it("ends the lease even when the authoring call throws", () => {
    expect(() =>
      withLease(() => {
        throw new Error("authoring failed");
      })
    ).toThrow("authoring failed");

    const afterwards = openRecording(undefined, [], []);
    expect(afterwards.lease).toBeUndefined();
    closeRecording(afterwards);
  });
});

describe("the synchronous closure rule", () => {
  it("refuses a thenable and lets no unhandled rejection escape it", async () => {
    // Refusing the promise is not the same as containing it: with nothing
    // attached, its rejection is an `unhandledRejection`, which by default
    // takes the process down after the diagnostic was already thrown.
    const escaped: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      escaped.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      const abandoned = Promise.reject(new Error("the continuation failed"));
      expect(() => assertSynchronousClosure(abandoned, "A test closure")).toThrow(
        /returned a promise/
      );
      // Two macrotask turns: long enough for Node to have decided whether the
      // rejection was unhandled.
      await new Promise((resolve) => setTimeout(resolve, 10));
      await new Promise((resolve) => setTimeout(resolve, 10));
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
    expect(escaped).toEqual([]);
  });

  it("leaves anything that is not a thenable alone", () => {
    expect(() => assertSynchronousClosure(undefined, "A test closure")).not.toThrow();
    expect(() => assertSynchronousClosure(null, "A test closure")).not.toThrow();
    expect(() =>
      assertSynchronousClosure({ then: "not a function" }, "A test closure")
    ).not.toThrow();
  });
});
