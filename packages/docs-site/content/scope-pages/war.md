# War

A war is an aggregate conflict context with participants and opposing sides. Scripts can iterate
attackers, defenders, and all participants, remove a participant, set the war goal, and store war
flags. It coordinates conflict-wide state rather than the fleets, armies, and countries acting
inside the war.

## Common entry points

Common entry points are war iterators and typed callbacks that supply a `WarScope`; outgoing links
identify the attacker, defender, and proxy-war instigator countries.
