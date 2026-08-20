# Megastructure

A megastructure is a large installation with construction or upgrade state. Scripts can finish or
halt an upgrade, move to another upgrade definition, manage associated bypasses, and store
megastructure flags. It provides a typed setting for large engineered projects without assuming a
specific megastructure type or visual form.

## Common entry points

Common entry points are megastructure operations and typed callbacks that supply a
`MegastructureScope`; the SDK generates no generic megastructure event kind.
