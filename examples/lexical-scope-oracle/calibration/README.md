# Lexical scope oracle

Status: complete on Stellaris Pegasus 4.4.6 (`fdde`).

This raw PDXScript fixture validates the game behavior needed by SDK-215. It
measures the game's scope behavior independently of the SDK recorder.

## Install

From the repository root, install the fixture at the descriptor's declared
path:

```sh
mkdir -p "$HOME/Documents/Paradox Interactive/Stellaris/mod/pdx_lexical_scope_oracle"
cp -R examples/lexical-scope-oracle/mod/. \
  "$HOME/Documents/Paradox Interactive/Stellaris/mod/pdx_lexical_scope_oracle/"
cp examples/lexical-scope-oracle/pdx_lexical_scope_oracle.mod \
  "$HOME/Documents/Paradox Interactive/Stellaris/mod/pdx_lexical_scope_oracle.mod"
```

Enable only **PDX Lexical Scope Oracle**, load a non-Ironman country with a
capital planet, and run:

```text
event pdx_lexical_scope_oracle.1
```

Inspect `game.log` for each `PDX_LEXICAL_SCOPE_ORACLE_` marker and `error.log`
for parser or wrong-scope errors.

## Required observations

- `IF_SAME_COUNTRY` and `HIDDEN_SAME_COUNTRY` prove structural blocks preserve
  the exact root country identity (`is_same_value = root`).
- `PREV_COUNTRY` proves one pushed iterator can reach that exact lexical
  country identity.
- `PREVPREV_COUNTRY` proves a second pushed block reaches that same exact
  country identity.
- `ITERATOR_THIS_COLONY` records the iterator's runtime colony behavior
  independently of the CWT `planet` landing type.
- `SPLIT_THIS_PLANET` and `SPLIT_ROOT_COUNTRY` calibrate the split-root
  initializer context used by generated content fields.

The SDK runtime fails closed for replacements, unknown transitions, and depths
greater than four. This fixture is intentionally separate from the natural
FROM oracle: lexical `PREV*` routing must not be inferred from event FROM.

## Observations

- **Exact game build:** `Pegasus v4.4.6 (fdde)`.
- `IF_SAME_COUNTRY` and `HIDDEN_SAME_COUNTRY` both matched the exact root
  country, confirming that these structural blocks preserve scope identity.
- `PREV_COUNTRY` and `PREVPREV_COUNTRY` both matched the exact root country,
  confirming one-hop and two-hop lexical ancestor routing.
- `ITERATOR_THIS_COLONY` confirmed the runtime iterator scope independently
  of its CWT landing type.
- `SPLIT_THIS_PLANET` and `SPLIT_ROOT_COUNTRY` confirmed the initializer's
  split THIS/root context.

Every required marker appeared in one clean run. `error.log` contained no
oracle parser, missing-event, or wrong-scope errors. Normalized excerpts from
that run are checked in as `game.log` and `error.log`.
