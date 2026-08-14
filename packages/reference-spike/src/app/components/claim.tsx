/**
 * How a claim reads, which is the entire hypothesis in one component.
 *
 * A Supported contract is set as ordinary prose with a quiet chip beside it:
 * marking it would tell the reader to be careful about the one kind of sentence
 * they do not have to be careful about. The other four are callouts — a colored
 * rail, a loud badge, and the status' meaning spelled out — because "the game
 * does this once", "a maintainer thinks this", "the SDK cannot do this" and
 * "nobody knows" all cost the reader something, and a page that hides which is
 * which is worse than no page.
 *
 * Provenance sits behind a disclosure in both cases. It has to be there — a
 * claim you cannot check is an assertion — and it has to be closed, or ordinary
 * reading turns into reading an audit log.
 *
 * Typeset styles the surrounding markdown, so the chrome here — badges, the
 * status meaning, the evidence list — opts out with `not-typeset`. What stays
 * in is the claim's own prose, whether that is a generated sentence or the
 * paragraphs a maintainer wrote in the MDX.
 */

import type { ReactNode } from "react";

import type { CuratedConvention } from "../../build.ts";
import {
  isMarked,
  STATUS_LABEL,
  STATUS_MEANING,
  type ClaimStatus,
  type GuidanceDependency,
  type Provenance,
  type ReferenceClaim,
} from "../../claims.ts";
import { InlineCode } from "./inline-code.tsx";
import { Badge, type BadgeTone } from "./ui/primitives.tsx";

const TONE: Record<ClaimStatus, BadgeTone> = {
  "supported-contract": "contract",
  "observed-example": "observed",
  "curated-convention": "curated",
  "known-omission": "omission",
  "unresolved-behavior": "unresolved",
};

const RAIL: Record<ClaimStatus, string> = {
  "supported-contract": "border-l-contract",
  "observed-example": "border-l-observed",
  "curated-convention": "border-l-curated",
  "known-omission": "border-l-omission",
  "unresolved-behavior": "border-l-unresolved",
};

const PROVENANCE_LABEL: Record<string, string> = {
  "cwt-rule": "CWT rule",
  "codegen-projection": "Projected from the authoring model",
  "sdk-source": "Hand-written SDK source",
  corpus: "Committed corpus",
  "recorded-disposition": "Recorded disposition",
  maintainer: "Maintainer judgment",
};

function Evidence({
  id,
  provenance,
  guidance,
  supporting = [],
}: {
  id: string;
  provenance: readonly Provenance[];
  guidance: readonly GuidanceDependency[];
  supporting?: readonly ReferenceClaim[];
}) {
  return (
    <details data-testid={`evidence-${id}`} data-not-typeset className="not-typeset mt-3">
      <summary className="cursor-pointer select-none text-xs text-muted-foreground hover:text-foreground">
        Evidence ({provenance.length}
        {guidance.length > 0 ? `, ${guidance.length} dependencies` : ""})
      </summary>
      <dl className="mt-2 space-y-2 border-l border-border pl-3 text-xs">
        {supporting.map((observation) => (
          <div key={observation.id} data-testid={`supporting-${observation.id}`}>
            <dt className="font-medium">{STATUS_LABEL[observation.status]}</dt>
            <dd className="text-muted-foreground">
              <InlineCode text={observation.statement} />
            </dd>
          </div>
        ))}
        {provenance.map((entry) => (
          <div key={`${entry.kind}:${entry.source}`}>
            <dt className="font-medium">{PROVENANCE_LABEL[entry.kind] ?? entry.kind}</dt>
            <dd className="break-all font-mono text-muted-foreground">{entry.source}</dd>
            {entry.detail !== undefined && (
              <dd className="text-muted-foreground">{entry.detail}</dd>
            )}
          </div>
        ))}
        {guidance.length > 0 && (
          <div>
            <dt className="font-medium">Guidance dependencies</dt>
            {guidance.map((dependency) => (
              <dd key={dependency.subject} className="font-mono text-muted-foreground">
                {dependency.subject}{" "}
                <span className="opacity-60">
                  ({dependency.kind} · {dependency.fingerprint})
                </span>
              </dd>
            ))}
          </div>
        )}
      </dl>
    </details>
  );
}

/**
 * The shell both a derived claim and a curated convention render inside.
 *
 * A marked claim is a callout: a coloured rail, a badge, and the status spelled
 * out. An unmarked one — every Supported contract — is just its sentence, set
 * as ordinary prose with a quiet evidence link. That asymmetry is the design.
 * The page is mostly true things, and a reader who has been shown a badge on
 * every true sentence has been trained to skip badges by the time they reach
 * the one that says nobody knows.
 */
function Shell({
  id,
  subject,
  status,
  provenance,
  guidance,
  supporting,
  children,
}: {
  id: string;
  subject: string;
  status: ClaimStatus;
  provenance: readonly Provenance[];
  guidance: readonly GuidanceDependency[];
  supporting?: readonly ReferenceClaim[];
  children: ReactNode;
}) {
  if (!isMarked(status)) {
    return (
      <div data-testid={`claim-${id}`} data-status={status} data-subject={subject}>
        {children}
        <Evidence id={id} provenance={provenance} guidance={guidance} supporting={supporting} />
      </div>
    );
  }
  return (
    <div
      data-testid={`claim-${id}`}
      data-status={status}
      data-subject={subject}
      className={`my-5 rounded-r-lg border-l-4 bg-muted/40 px-4 py-3 ${RAIL[status]}`}
    >
      <div data-not-typeset className="not-typeset mb-1.5 flex flex-wrap items-center gap-2">
        <Badge tone={TONE[status]}>{STATUS_LABEL[status]}</Badge>
        <span className="font-mono text-xs text-muted-foreground">{subject}</span>
      </div>
      {children}
      <p data-not-typeset className="not-typeset mt-2 text-xs text-muted-foreground">
        {STATUS_MEANING[status]}
      </p>
      <Evidence id={id} provenance={provenance} guidance={guidance} supporting={supporting} />
    </div>
  );
}

/**
 * A derived claim: the sentence was generated, so it is rendered from the
 * snapshot rather than written in the MDX.
 *
 * `supporting` are the observations that exist as evidence for this claim
 * rather than as claims of their own — corpus counts, mostly. They go inside
 * the disclosure. A reader deciding whether they can use the conditional
 * `picture` form is not helped by being told how many shipped files use it;
 * a reader checking whether the page is lying to them is.
 */
export function Claim({
  claim,
  supporting,
}: {
  claim: ReferenceClaim | undefined;
  supporting?: readonly ReferenceClaim[];
}) {
  if (claim === undefined) {
    return null;
  }
  return (
    <Shell
      id={claim.id}
      subject={claim.subject}
      status={claim.status}
      provenance={claim.provenance}
      guidance={claim.guidance}
      supporting={supporting}
    >
      <p className="text-sm leading-relaxed">
        <InlineCode text={claim.statement} />
      </p>
    </Shell>
  );
}

/**
 * A curated convention: the prose comes from the MDX, everything else from the
 * snapshot.
 *
 * The children are the paragraphs somebody wrote, rendered by MDX and styled by
 * Typeset. The badge, the status meaning and the guidance dependencies are the
 * machine half, and they are the same shell a derived claim uses so the reader
 * can see at a glance that this one is a judgment.
 */
export function Convention({
  convention,
  children,
}: {
  convention: CuratedConvention | undefined;
  children: ReactNode;
}) {
  if (convention === undefined) {
    return null;
  }
  return (
    <Shell
      id={convention.id}
      subject={convention.subject}
      status={convention.status}
      provenance={convention.provenance}
      guidance={convention.guidance}
    >
      <div className="text-sm">{children}</div>
    </Shell>
  );
}
