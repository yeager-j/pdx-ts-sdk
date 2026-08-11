# Triggers are declarative trees; effects are build-time closures

The two halves of Stellaris script look symmetrical, so the asymmetry here is
deliberate and worth stating: a trigger is a declarative expression tree — a
value you can inspect, type, and interpret — while an effect is a closure
executed once at build time whose only job is to record untyped PDXScript
entries. Those entries are data, and `@pdx-ts/sdk-testing` consumes them by
key. What the closure design avoids is a second, typed semantic effect AST and
its own lowering contract; ordinary TypeScript control flow can emit syntax
directly instead.

The accepted cost is the recorder's liveness and async guard machinery: it
rejects leaked scope objects, thenables, and async closures, failure modes a
value AST would not have. Effects run, so ordinary control flow works inside
them, and recording is scope-agnostic at runtime — generated interfaces, not
the recorder, decide which effects and scope transitions are legal.

Evidence: `packages/sdk/tests/effects.test.ts` and `effects.test-d.ts` for the
recording and its scope typing; `packages/sdk/tests/events.test-d.ts` for the
witness contract at a fire site.
