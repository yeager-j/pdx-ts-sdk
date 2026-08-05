# Triggers are declarative trees; effects are build-time closures

The two halves of Stellaris script look symmetrical, so the asymmetry here is
deliberate and worth stating: a trigger is a declarative expression tree — a
value you can inspect, type, and interpret — while an effect is a closure
executed once at build time whose only job is to record AST entries. Triggers
are asymmetric because things want to _read_ them: the type system narrows them
by scope, and `@pdx-ts/sdk-testing` interprets them to explain which
subcondition failed. Nothing needs to read an effect back, and modelling
effects as data too would have bought a second AST for no consumer.

The consequence a reader should expect: effects run, so ordinary control flow
works inside them, and effect recording is scope-agnostic at runtime — it is
the generated interfaces, not the recorder, that decide which effects and scope
transitions are legal.

Evidence: [verdict-effects-probe.md](../verdict/verdict-effects-probe.md).
