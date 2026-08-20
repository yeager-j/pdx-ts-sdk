import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(
  new URL("../.next/server/app/reference/situations.html", import.meta.url),
  "utf8"
);

assert.doesNotMatch(html, /has no `\$` id placeholder/);
assert.match(html, /has no <code>\$<\/code> id placeholder/);
assert.doesNotMatch(html, /<id>/);
assert.match(html, /not a static &#x3C;id>-keyed slot/);
