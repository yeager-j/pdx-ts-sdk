# Design

A design is a reusable ship blueprint rather than an individual ship. Scripts can store design
flags and control automatic component upgrades, while the wider ship-building flow remains on ship
and country contexts. It is useful for content that needs to identify or annotate a blueprint
independently of ships built from it.

## Common entry points

Common entry points include a ship's `design` link and the `lastCreatedDesign` link.
