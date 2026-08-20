# Ship growth stage

A ship growth stage is the current growth-stage value inside a ship's design. The generated SDK
provides a narrow typed context with no dedicated event kind or growth-stage-specific ordinary
effects. It is useful for script contracts that inspect a design's current stage without assuming
a biological or construction lifecycle.

## Common entry points

The canonical entry point is a ship's `shipGrowthStage` link, which supplies a
`ShipGrowthStageScope`.
