/** Protocol revision; freeze together with shared source after the native baseline. */
export const revision = "sdk-446/v1-draft";
/** The bounded native kinds in this experiment. */
export type Scope = "country" | "planet";
/** Adapter-issued wire token, never an address or a numeric game ID as authority. */
export type Binding = Readonly<{ token: string; world: string; scope: Scope }>;
/** Host-selected invocation identity, echoed from the native invocation context. */
export type Invocation = Readonly<{ run: string; world: string; phase: string; id: string }>;
/** Readiness and date observation. Day is an integral game-day index, not host time. */
export type Snapshot = Readonly<{
  world: string;
  day: number;
  paused: boolean;
  player: string;
  ai: "off" | "on";
}>;
/** Fixed scope and bytes loaded before any scenario operation. */
export type Script = Readonly<{ scope: Scope; kind: "effect" | "condition"; body: string }>;
/** Parsed event identity and exact definition bytes, fixed before the game starts. */
export type PreparedScript = Script & Readonly<{ definitionId: string; definition: string }>;
/** Locators are fixed before launch; no arbitrary numeric lookup is exposed. */
export type Locator =
  | { kind: "player"; scope: "country" }
  | { kind: "target"; scope: Scope; name: string }
  | { kind: "unique"; scope: Scope; condition: string };
/** Neutral command set. Only advance may change the game date. */
export type Command =
  | { kind: "snapshot" }
  | { kind: "resolve"; locator: Locator }
  | { kind: "validate"; binding: Binding }
  | { kind: "invoke"; binding: Binding; script: string }
  | { kind: "advance"; days: number };
/** Required raw references are relative to the run's evidence directory. */
export type Evidence = Readonly<{
  invocation: Invocation;
  before: Snapshot;
  after: Snapshot;
  raw: readonly string[];
  nativeCompleted: boolean;
  script?: {
    id: string;
    sha256: string;
    markers: readonly string[];
    correlatedAtNativeBoundary: boolean;
  };
}>;
/** Rejections certify no requested mutation; uncertain work is incomplete. */
export type Outcome =
  | {
      kind: "completed";
      value: Snapshot | Binding | boolean | { subject: string };
      evidence: Evidence;
    }
  | {
      kind: "rejected";
      reason: "missing-object" | "wrong-object-kind" | "ambiguous-object" | "invalid-binding";
      mutation: "none";
      evidence: Evidence;
    }
  | { kind: "contract-error"; reason: "foreign-binding"; mutation: "none"; evidence: Evidence }
  | { kind: "incomplete"; causes: readonly string[]; raw: readonly string[] };
/** Exact inputs travel unchanged into the result; paths are adapter configuration. */
export type Metadata = Readonly<{
  mode: "mock" | "native";
  adapterRevision: string;
  environment: {
    os: string;
    cpu: string;
    game: string;
    executableSha256: string;
    bridgeSha256: string;
  };
  fixture: {
    semanticRevision: string;
    saveSha256: string;
    sourceBuild: string;
    dependencies: readonly { name: string; sha256: string }[];
  };
}>;
/** Context is available to the independent cleanup process even if launch never returns. */
export type Context = Readonly<{
  runId: string;
  directory: string;
  configuration: unknown;
  scripts: Readonly<Record<string, PreparedScript>>;
  scriptHashes: Readonly<Record<string, string>>;
}>;
/** Cancellation is advisory; the supervisor enforces its own wall-clock deadline. */
export type Control = Readonly<{ signal: AbortSignal; deadlineEpochMs: number }>;
/** Launch must journal owned resources before creation; readiness includes fixture validation. */
export interface Adapter {
  /** Revalidate installation and load the version-appropriate private fixture, paused. */
  launch(
    control: Control
  ): Promise<{ metadata: Metadata; ready: Snapshot; raw: readonly string[] }>;
  /** Execute once at a verified native boundary; never retry uncertain effects. */
  perform(command: Command, invocation: Invocation, control: Control): Promise<Outcome>;
}
/** Cleanup preserves diagnostics before disposing the profile; unknown exit cannot pass. */
export type Cleanup = Readonly<{
  processExit: "confirmed" | "unconfirmed";
  profile: "removed" | "retained" | "failed";
  evidenceRetained: boolean;
  raw: readonly string[];
}>;
/** Loaded only by the composition worker, never imported by shared checks. */
export interface AdapterModule {
  /** Create a control client; this must not launch a game before launch(). */
  create(context: Context): Adapter;
  /** Independent recovery from the durable ownership record; must not require the old worker. */
  disposeOwned(context: Context, control: Control): Promise<Cleanup>;
}
