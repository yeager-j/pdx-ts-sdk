# No scope

No scope is the explicit empty context for generalized script with no current game object. It can
still use operations whose contracts permit `NoScopeScope`, including shared control flow and
specific iterators such as espionage-asset iteration. It is plumbing for intentionally context-free behavior, not a hidden object with
its own lifecycle.

## Common entry points

Common entry points include the generated `noScope` transition and callbacks whose contract
explicitly supplies `NoScopeScope`.
