/**
 * The hand-written SDK contracts, which are the page's weakest link and say so.
 *
 * A contract is here precisely because the CWT rules are silent, so there is
 * nothing in the post-overlay model to project and nothing the probe can
 * derive. `targetScope` is the case that matters: it looks exactly like a
 * field, sits in the same object literal as the fields, and emits nothing. A
 * page that showed only what codegen knows would either omit the SDK's most
 * useful situation feature or present it as though it had been derived.
 *
 * So each one names the source file that implements it, and
 * `tests/citations.test.ts` reads those files as text to check the anchors
 * still exist. Extracted from `App.tsx` with `EvidenceSummary`; see that file
 * for why.
 */

import type { ReferenceBuild } from "../../build.ts";
import { InlineCode } from "./inline-code.tsx";
import { Badge, Card } from "./ui/primitives.tsx";

export function SdkContracts({ build }: { build: ReferenceBuild }) {
  return (
    <div data-not-typeset className="not-typeset my-5 space-y-3">
      {build.sdkContracts.map((contract) => (
        <Card key={contract.member} className="p-4" data-testid={`sdk-contract-${contract.member}`}>
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm">{contract.member}</span>
            <Badge tone="contract">SDK-authored</Badge>
            <Badge>{contract.serialized ? "reaches the output" : "emits nothing"}</Badge>
          </div>
          <p className="text-sm leading-relaxed">
            <InlineCode text={contract.statement} />
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            <span className="font-medium">Why the rules cannot say this: </span>
            <InlineCode text={contract.whyNotDerived} />
          </p>
          <p className="mt-1 font-mono text-xs text-muted-foreground">{contract.source}</p>
        </Card>
      ))}
    </div>
  );
}
