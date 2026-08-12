# Natural FROM oracle

Status: complete on Stellaris Pegasus 4.4.6.

This is deliberately raw PDXScript rather than SDK output. The observation
must measure the game's unoverridden event-fire behavior, not whatever the
SDK recorder currently assumes that behavior to be.

## Install

From the repository root, copy the fixture and launcher descriptor into the
local mod directory:

```sh
mkdir -p "$HOME/Documents/Paradox Interactive/Stellaris/mod/pdx_from_oracle"
cp -R examples/from-oracle/mod/. \
  "$HOME/Documents/Paradox Interactive/Stellaris/mod/pdx_from_oracle/"
cp examples/from-oracle/pdx_from_oracle.mod \
  "$HOME/Documents/Paradox Interactive/Stellaris/mod/pdx_from_oracle.mod"
```

Enable only **PDX FROM Oracle**. Load a non-Ironman country with at least one
owned capital planet, open the console, and run:

```text
event pdx_from_oracle.1
```

The entry event runs in country scope. It fires one country event at top level,
one colony event inside `every_owned_planet`, then spawns a tiny system whose
planet `init_effect` fires the third event. None of the three fire blocks writes
a `scopes` override.

Search `game.log` for `PDX_FROM_ORACLE_`. The setup markers distinguish a real
FROM result from a fixture that ran in the wrong scopes. Also inspect
`error.log` for `pdx_from_oracle` before accepting the result.

## Observations

- **Exact game build:** `Pegasus v4.4.6 (fdde)`.
- **Top-level baseline:** the entry ran with THIS and ROOT both country; the
  unoverridden country event received a country as FROM.
- **Nested iterator:** `every_owned_planet` ran with THIS as colony and ROOT as
  country; the unoverridden colony event received a country as FROM.
- **Split-root initializer:** the planet `init_effect` ran with THIS as planet
  and ROOT as country; the unoverridden planet event received a country as
  FROM.

All three cases agree: an event fired without a `scopes.from` override receives
the firing execution's ROOT as FROM, not the call-site THIS scope.

The iterator also exposed a separate CWT/runtime disagreement: the vendored
rule declares `every_owned_planet` as `push_scope = planet`, but the game
reported its current scope as `colony` and rejected `planet_event` there. The
oracle uses `colony_event` so that mismatch cannot obscure the FROM result; it
is not part of SDK-144's witness-contract repair.

`error.log` contained one placement fallback from `spawn_system`: no position
met the buffer distance, so the game retried without that buffer. The system
then spawned and produced every split-root setup and FROM marker. There were no
oracle parser errors, wrong-scope errors, or missing event errors in the clean
run.

Normalized excerpts from the clean run are checked in as `game.log` and
`error.log`. Generated files, the SDK test interpreter, and CWT comments are
not runtime evidence and could not have completed this record.
