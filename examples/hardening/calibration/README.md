# Hardening calibration

Status: complete on Stellaris Pegasus 4.4.6.

This record must not be marked complete from generated files or evaluator
results alone. The initial run established the game-defined queue and target
semantics, then exposed fixture errors. The corrected corpus was rebuilt and
passed a clean second run.

## Build and install

From the repository root:

```sh
npm run build
node examples/hardening/build.ts \
  "$HOME/Documents/Paradox Interactive/Stellaris/mod/pdx_hardening"
```

The build writes the content directory and the adjacent
`pdx_hardening.mod` launcher descriptor. Enable **PDX SDK Hardening**, start a
new game, and keep `debug.log` and `game.log` enabled.

## Runtime procedure

1. Start a new country and wait through day 2.
2. Confirm the generated marker technology, building, tradition/category,
   agenda, and edict are discoverable with `debugtooltip`.
3. Confirm the setup log reports 45 events for `on_game_start_country`. The
   Pegasus 4.4.6 vanilla definition contains 44 events, so 45 proves that the
   SDK event was appended rather than replacing the vanilla list.
4. Search `game.log` for `PDX_HARDENING_`.
5. After the order markers have appeared, run `event pdx_hardening.5` from
   country scope. The expiry probe start marker should appear; the
   `TARGET_STILL_AVAILABLE_AFTER_CHAIN` marker should not.
6. Inspect Gene Tailoring. Its emitted definition must have twice the parsed
   vanilla cost and include `SDK Hardening Marker` as a prerequisite; the
   marker technology must also remain present.
7. Search the parser and error logs for keys or files containing
   `pdx_hardening`; outside the intentional failed target lookup from step 5,
   there must be no parser, missing-asset, or unknown-key errors.

## Expected marker order to compare with the game

The evaluator is calibrated to predict:

```text
PDX_HARDENING_ENTRY
PDX_HARDENING_TARGET_AVAILABLE_IN_ENTRY
PDX_HARDENING_ORDER_B
PDX_HARDENING_ORDER_A
PDX_HARDENING_FROM_OVERRIDE_IS_PLANET
PDX_HARDENING_ORDER_C
PDX_HARDENING_EXPIRY_PROBE_STARTED
```

The game delivers events queued for the same day in last-enqueued-first order.
The zero-day cascade queued by `A` follows `A`.

## Observations

- **Exact game build:** `Pegasus v4.4.6`.
- **Loading and representative definitions:** the operator confirmed the
  technology, building, tradition/category, agenda, and edict were present and
  had the expected effects.
- **Additive `on_game_start_country` behavior:** the Pegasus 4.4.6 vanilla file
  contains 44 event ids under this hook; `setup.log` reported 45 after loading
  the mod. The SDK entry marker also fired.
- **Explicit FROM override:** event `pdx_hardening.2` logged
  `PDX_HARDENING_FROM_OVERRIDE_IS_PLANET`. This proves the saved planet target
  resolved while the delayed event was being scheduled and was delivered as
  its explicit FROM.
- **Event-target lifetime:** the saved target did not survive delayed event
  delivery. The later, correctly country-scoped `event pdx_hardening.5` command
  logged the probe-start marker, then produced an undefined-target error and
  never logged `PDX_HARDENING_TARGET_STILL_AVAILABLE_AFTER_CHAIN`.
- **Same-day and cascade delivery order:** the observed order was `B`, `A`,
  then `C`, contradicting the evaluator's original FIFO assumption. The
  production queue now uses last-enqueued-first delivery for equal due days.
- **Patch survival:** the operator confirmed both the authored marker and the
  transformed Gene Tailoring technology, including their effects. The duplicate
  `tech_gene_tailoring` diagnostic named the generated patch file, providing
  the patch verdict's second channel.

Normalized excerpts from the clean run are checked in as `game.log`,
`setup.log`, and `error.log`.

## Clean-rerun conclusion

The initial run emitted hardening-only diagnostics because the chain also ran
for game-created countries without planets, the building lacked
`building_sets`, and the technology/building/edict used invalid inferred
assets. The fixture now guards for an owned planet and declares known vanilla
assets and a building set. The cascade no longer attempts to read the expired
target; only the manual expiry probe is expected to produce that diagnostic.

The second run logged `PDX_HARDENING_TARGET_AVAILABLE_IN_ENTRY` and the complete
expected marker sequence. It produced no hardening parser, missing-asset,
no-planet, or cascade diagnostics. The duplicate `tech_gene_tailoring`
diagnostic is the intentional patch witness. The only other hardening
diagnostic followed the manual expiry probe and is its expected negative
result.
