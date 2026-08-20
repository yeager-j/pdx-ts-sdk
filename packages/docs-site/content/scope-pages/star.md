# Star

A star is the SDK's typed primary-star context for a system. The CWT rules describe the `star` link
as selecting that primary star but mechanically report its output as a planet scope, so this page
does not imply a separate mutable object model. `StarScope` is mainly a navigation and contract
context whose exact generated surface remains authoritative.

## Common entry points

Common entry points are star-level callbacks or script contracts that supply a `StarScope`; the SDK
generates no dedicated star event kind.
