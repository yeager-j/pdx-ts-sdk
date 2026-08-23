# Lexical scope oracle

Status: **pending live calibration** on Stellaris Pegasus 4.4.6 (`fdde`).

This raw PDXScript fixture validates the game behavior needed by SDK-215. It
does not constitute a completed calibration until a clean game run records the
markers below and confirms no related parser or scope errors.

## Run

Copy `mod/` and `pdx_lexical_scope_oracle.mod` into the local Stellaris mod
directory, enable only **PDX Lexical Scope Oracle**, load a non-Ironman country
with a capital planet, and run:

```text
event pdx_lexical_scope_oracle.1
```

Inspect `game.log` for each `PDX_LEXICAL_SCOPE_ORACLE_` marker and `error.log`
for parser or wrong-scope errors. Do not add normalized logs until that clean
run succeeds.

## Required observations

- `IF_SAME_COUNTRY` and `HIDDEN_SAME_COUNTRY` prove structural blocks preserve
  the current identity.
- `PREV_COUNTRY` proves one pushed iterator can reach its lexical country.
- `PREVPREV_COUNTRY` proves a second pushed block reaches that same country.
- `ITERATOR_THIS_COLONY` records the iterator's runtime colony behavior
  independently of the CWT `planet` landing type.
- `SPLIT_THIS_PLANET` and `SPLIT_ROOT_COUNTRY` calibrate the split-root
  initializer context used by generated content fields.

The SDK runtime fails closed for replacements, unknown transitions, and depths
greater than four. This fixture is intentionally separate from the natural
FROM oracle: lexical `PREV*` routing must not be inferred from event FROM.
