# Carrier

Carrier is the colony-to-carrier context exposed by the canonical `carrier` link. Its generated
surface shares many planet and colony operations, including terraforming, districts, buildings,
deposits, and planetary entities. It is a carrier context that exposes these planet and colony
operations without being interchangeable with an ordinary ship scope.

## Common entry points

Common entry points include `carrier_event` bodies, the link from a colony to its carrier, and typed
callbacks that supply a `CarrierScope`.
