/** A normalized GitHub pull request coordinate. */
export interface PullRequestReference {
  /** Repository owner. */
  readonly owner: string;
  /** Repository name. */
  readonly repository: string;
  /** Pull request number. */
  readonly number: number;
  /** Short coordinate used in poller output. */
  readonly label: string;
  /** Canonical GitHub pull request URL. */
  readonly url: string;
}

/** One inline finding posted by Codex. */
export interface CodexFinding {
  /** GitHub review comment ID. */
  readonly id: number;
  /** Repository-relative source path. */
  readonly path: string;
  /** Current or original diff line when GitHub supplies one. */
  readonly line?: number | null;
  /** Complete Markdown finding text. */
  readonly body: string;
  /** GitHub review comment URL when supplied by the API. */
  readonly url?: string;
}

/** The observed Codex review state for one pull request. */
export interface CodexReviewState {
  /** Pull request being observed. */
  readonly pullRequest: PullRequestReference;
  /** Current lifecycle state reported by the Codex summary comment. */
  readonly status: "waiting" | "running" | "completed";
  /** Commit abbreviations listed in the current Codex status table. */
  readonly commits: readonly string[];
  /** Last update time of the Codex status comment. */
  readonly summaryUpdatedAt?: string;
  /** Matching GitHub review ID when Codex posted findings. */
  readonly reviewId?: number;
  /** Inline findings attached to the matching review. */
  readonly findings: readonly CodexFinding[];
}

/** Structural subset of a GitHub REST API comment used by the poller. */
export interface GitHubComment {
  readonly id: number;
  readonly user?: { readonly login?: string };
  readonly body?: string | null;
  readonly created_at?: string;
  readonly updated_at?: string;
  readonly html_url?: string;
  readonly path?: string;
  readonly line?: number | null;
  readonly original_line?: number | null;
  readonly pull_request_review_id?: number | null;
}

/** Structural subset of a GitHub REST API pull request review used by the poller. */
export interface GitHubReview {
  readonly id: number;
  readonly user?: { readonly login?: string };
  readonly body?: string | null;
  readonly commit_id?: string;
  readonly submitted_at?: string;
}

/** Testable effect boundaries and timing controls for the polling loop. */
export interface WatchCodexReviewOptions {
  /** Delay between polls in milliseconds. */
  readonly intervalMs?: number;
  /** Return after one request instead of waiting for completion. */
  readonly once?: boolean;
  /** Loads one pull request state. Defaults to the authenticated GitHub CLI. */
  readonly loadState?: (pullRequest: PullRequestReference) => Promise<CodexReviewState>;
  /** Receives each changed report without a trailing newline. */
  readonly write?: (message: string) => void;
  /** Wait implementation used between polling rounds. */
  readonly sleep?: (durationMs: number) => Promise<void>;
}

/** Parses a GitHub pull request URL or an `owner/repository#number` reference. */
export function parsePullRequestReference(reference: string): PullRequestReference;

/** Derives current Codex activity and findings from GitHub REST API objects. */
export function deriveCodexReviewState(
  pullRequest: PullRequestReference,
  issueComments: readonly GitHubComment[],
  reviews: readonly GitHubReview[],
  reviewComments: readonly GitHubComment[]
): CodexReviewState;

/** Formats one changed Codex state as concise, agent-readable text. */
export function formatCodexReviewState(state: CodexReviewState): string;

/** Polls pull requests, writes changed states, and stops when all reviews complete. */
export function watchCodexReviews(
  pullRequests: readonly PullRequestReference[],
  options?: WatchCodexReviewOptions
): Promise<readonly CodexReviewState[]>;
