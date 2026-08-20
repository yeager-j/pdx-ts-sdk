# Bypass

A bypass is a travel-connection object, such as a wormhole-like route. Scripts can lock it for a
country, renew that lock, and link paired wormholes. It models access-controlled connections
between systems without assuming that every bypass has the same in-game presentation.

## Common entry points

Common entry points include `bypass_event` bodies and typed callbacks that supply a `BypassScope`.
