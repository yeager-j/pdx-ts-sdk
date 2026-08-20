# Debris

Debris is a wreckage object left in space. Its scoped API can transfer debris ownership and perform
the supported space-fauna reanimation operation, while standard links provide owner and system
context. It gives post-destruction content a typed object to inspect without defining a separate
debris event lifecycle.

## Common entry points

Common entry points are typed callbacks or script contracts that supply a `DebrisScope`; the SDK
generates no debris-specific event kind.
