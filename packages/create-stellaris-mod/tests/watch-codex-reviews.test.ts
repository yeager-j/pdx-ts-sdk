import { describe, expect, it, vi } from "vitest";

import {
  deriveCodexReviewState,
  formatCodexReviewState,
  parsePullRequestReference,
  watchCodexReviews,
  type CodexReviewState,
  type GitHubComment,
  type GitHubReview,
} from "../../../scripts/watch-codex-reviews.mjs";

const { execFileMock } = vi.hoisted(() => ({ execFileMock: vi.fn() }));

vi.mock("node:child_process", () => ({ execFile: execFileMock }));

const pullRequest = parsePullRequestReference("yeager-j/pdx-ts-sdk#277");
const codex = { login: "chatgpt-codex-connector[bot]" };

function summary(status: string, commit = "e363bfa"): GitHubComment {
  return {
    id: 1,
    user: codex,
    updated_at: "2026-08-31T00:08:34Z",
    body: `<!-- codex-pull-request-review-summary -->
| Review | Status | Commit | Review trigger |
| --- | --- | --- | --- |
| 📝 **Code Review** | ${status} | \`${commit}\` | Draft marked ready |`,
  };
}

describe("Codex review polling", () => {
  it("accepts canonical URLs and short references", () => {
    expect(parsePullRequestReference("https://github.com/yeager-j/pdx-ts-sdk/pull/277")).toEqual(
      pullRequest
    );
    expect(pullRequest).toMatchObject({
      owner: "yeager-j",
      repository: "pdx-ts-sdk",
      number: 277,
      label: "yeager-j/pdx-ts-sdk#277",
    });
    expect(() => parsePullRequestReference("pdx-ts-sdk#277")).toThrow(/Invalid pull request/u);
    expect(() => parsePullRequestReference("https://github.com/owner//pull/277")).toThrow(
      /Invalid GitHub pull request URL/u
    );
    expect(() => parsePullRequestReference("https://github.com//repo/pull/277")).toThrow(
      /Invalid GitHub pull request URL/u
    );
  });

  it("reports waiting and running status from the summary comment", () => {
    expect(deriveCodexReviewState(pullRequest, [], [], [])).toMatchObject({ status: "waiting" });
    expect(
      deriveCodexReviewState(pullRequest, [summary("👀 **In progress**")], [], [])
    ).toMatchObject({ status: "running", commits: ["e363bfa"] });
  });

  it("waits for the current head and stops on terminal failure", () => {
    expect(
      deriveCodexReviewState(
        pullRequest,
        [summary("✅ **Completed**")],
        [],
        [],
        "bbbbbbb000000000000000000000000000000000"
      )
    ).toMatchObject({ status: "waiting", commits: ["bbbbbbb"] });
    expect(
      deriveCodexReviewState(
        pullRequest,
        [summary("❌ **Failed**")],
        [],
        [],
        "e363bfa000000000000000000000000000000000"
      )
    ).toMatchObject({ status: "failed", failure: "❌ **Failed**" });
  });

  it("waits for every review row before reporting a failure", () => {
    const mixedSummary: GitHubComment = {
      ...summary("❌ **Failed**"),
      body: `<!-- codex-pull-request-review-summary -->
| Review | Status | Commit | Review trigger |
| --- | --- | --- | --- |
| 📝 **Code Review** | 👀 **In progress** | \`e363bfa\` | Comment |
| 🔒 **Security Review** | ❌ **Failed** | \`e363bfa\` | Comment |`,
    };

    expect(deriveCodexReviewState(pullRequest, [mixedSummary], [], [])).toMatchObject({
      status: "running",
    });
  });

  it("links completed findings to the latest matching Codex review", () => {
    const reviews: GitHubReview[] = [
      {
        id: 10,
        user: codex,
        submitted_at: "2026-08-30T23:00:00Z",
        commit_id: "aaaaaaa000000000000000000000000000000000",
        body: "### 💡 Codex Review",
      },
      {
        id: 11,
        user: codex,
        submitted_at: "2026-08-31T00:08:29Z",
        commit_id: "e363bfad81490a55614e2f3966c1cbbe3e595029",
        body: "### 💡 Codex Review",
      },
    ];
    const comments: GitHubComment[] = [
      {
        id: 20,
        user: codex,
        pull_request_review_id: 10,
        path: "old.ts",
        original_line: 1,
        body: "Old finding",
      },
      {
        id: 21,
        user: codex,
        pull_request_review_id: 11,
        path: "src/exec.ts",
        line: null,
        original_line: 101,
        body: "Use Windows-compatible quoting.",
      },
      {
        id: 22,
        user: { login: "reviewer" },
        pull_request_review_id: 11,
        path: "src/exec.ts",
        line: 102,
        body: "Human reply",
      },
    ];

    const state = deriveCodexReviewState(
      pullRequest,
      [summary("✅ **Completed**")],
      reviews,
      comments
    );

    expect(state).toMatchObject({
      status: "completed",
      reviewIds: [11],
      findings: [
        {
          id: 21,
          path: "src/exec.ts",
          line: 101,
          body: "Use Windows-compatible quoting.",
        },
      ],
    });
    expect(formatCodexReviewState(state)).toContain(
      "[yeager-j/pdx-ts-sdk#277] Codex review completed for e363bfa with 1 finding.\n\nsrc/exec.ts:101"
    );
  });

  it("collects findings from every matching completed review", () => {
    const reviews: GitHubReview[] = [
      {
        id: 11,
        user: codex,
        submitted_at: "2026-08-31T00:08:28Z",
        commit_id: "e363bfad81490a55614e2f3966c1cbbe3e595029",
        body: "### 💡 Codex Review",
      },
      {
        id: 12,
        user: codex,
        submitted_at: "2026-08-31T00:08:29Z",
        commit_id: "e363bfad81490a55614e2f3966c1cbbe3e595029",
        body: "### 💡 Codex Review",
      },
    ];
    const comments: GitHubComment[] = reviews.map((review, index) => ({
      id: 20 + index,
      user: codex,
      pull_request_review_id: review.id,
      path: `src/review-${index}.ts`,
      line: index + 1,
      body: `Finding ${index}`,
    }));

    expect(
      deriveCodexReviewState(pullRequest, [summary("✅ **Completed**")], reviews, comments)
    ).toMatchObject({
      status: "completed",
      reviewIds: [11, 12],
      findings: [{ id: 20 }, { id: 21 }],
    });
  });

  it("waits for GitHub to expose a completed result", () => {
    const completedSummary = [summary("✅ **Completed**")];
    const headCommit = "e363bfad81490a55614e2f3966c1cbbe3e595029";

    expect(deriveCodexReviewState(pullRequest, completedSummary, [], [], headCommit)).toMatchObject(
      { status: "settling" }
    );
    expect(
      deriveCodexReviewState(pullRequest, completedSummary, [], [], headCommit, [
        {
          id: 29,
          user: codex,
          content: "+1",
          created_at: "2026-08-31T00:08:33Z",
        },
      ])
    ).toMatchObject({ status: "settling" });
    expect(
      deriveCodexReviewState(pullRequest, completedSummary, [], [], headCommit, [
        {
          id: 30,
          user: codex,
          content: "+1",
          created_at: "2026-08-31T00:08:35Z",
        },
      ])
    ).toMatchObject({ status: "completed", findings: [] });
    expect(
      deriveCodexReviewState(
        pullRequest,
        completedSummary,
        [],
        [],
        headCommit,
        [],
        "2026-08-31T00:09:34Z"
      )
    ).toMatchObject({ status: "completed", findings: [] });
  });

  it("waits for inline comments after a matching review appears", () => {
    expect(
      deriveCodexReviewState(
        pullRequest,
        [summary("✅ **Completed**")],
        [
          {
            id: 11,
            user: codex,
            submitted_at: "2026-08-31T00:08:29Z",
            commit_id: "e363bfad81490a55614e2f3966c1cbbe3e595029",
            body: "### 💡 Codex Review",
          },
        ],
        []
      )
    ).toMatchObject({ status: "settling" });
  });

  it("does not reuse a review from before a same-head review request", () => {
    const completedSummary = summary("✅ **Completed**");
    const trigger: GitHubComment = {
      id: 2,
      user: { login: "reviewer" },
      body: "@codex review",
      created_at: "2026-08-31T00:08:35Z",
    };
    const priorReview: GitHubReview = {
      id: 11,
      user: codex,
      submitted_at: "2026-08-31T00:08:29Z",
      commit_id: "e363bfad81490a55614e2f3966c1cbbe3e595029",
      body: "### 💡 Codex Review",
    };
    const headCommit = "e363bfad81490a55614e2f3966c1cbbe3e595029";

    expect(
      deriveCodexReviewState(
        pullRequest,
        [completedSummary, trigger],
        [priorReview],
        [],
        headCommit
      )
    ).toMatchObject({ status: "waiting" });
    expect(
      deriveCodexReviewState(
        pullRequest,
        [{ ...completedSummary, updated_at: "2026-08-31T00:08:40Z" }, trigger],
        [priorReview],
        [],
        headCommit
      )
    ).toMatchObject({ status: "settling" });
  });

  it("rejects a malformed inline finding without a path", () => {
    expect(() =>
      deriveCodexReviewState(
        pullRequest,
        [summary("✅ **Completed**")],
        [
          {
            id: 11,
            user: codex,
            submitted_at: "2026-08-31T00:08:29Z",
            commit_id: "e363bfad81490a55614e2f3966c1cbbe3e595029",
            body: "### 💡 Codex Review",
          },
        ],
        [{ id: 21, user: codex, pull_request_review_id: 11, body: "Finding" }]
      )
    ).toThrow("Codex review comment 21 has no source path");
  });

  it("does not write unchanged polls and stops after completion", async () => {
    const running: CodexReviewState = {
      pullRequest,
      status: "running",
      commits: ["e363bfa"],
      findings: [],
    };
    const completed: CodexReviewState = { ...running, status: "completed" };
    const observed = [running, { ...running, summaryUpdatedAt: "2026-08-31T00:08:34Z" }, completed];
    const output: string[] = [];
    let polls = 0;

    await watchCodexReviews([pullRequest], {
      intervalMs: 1,
      loadState: async () => observed[polls++] ?? completed,
      sleep: async () => undefined,
      write: (message) => output.push(message),
    });

    expect(polls).toBe(3);
    expect(output).toEqual([
      "[yeager-j/pdx-ts-sdk#277] Codex review is running for e363bfa.",
      "[yeager-j/pdx-ts-sdk#277] Codex review completed for e363bfa with no findings.",
    ]);
  });

  it("terminates when GitHub reports a draft pull request", async () => {
    execFileMock.mockImplementation((...args) => {
      const commandArgs = args[1] as string[];
      const callback = args.at(-1) as (
        error: null,
        result: { stdout: string; stderr: string }
      ) => void;
      const endpoint = commandArgs.at(-1);
      const response = endpoint?.includes("/pulls/")
        ? { draft: true, head: { sha: "e363bfad81490a55614e2f3966c1cbbe3e595029" } }
        : [[]];
      callback(null, { stdout: JSON.stringify(response), stderr: "" });
    });

    await expect(watchCodexReviews([pullRequest], { once: true })).rejects.toThrow(
      "yeager-j/pdx-ts-sdk#277 is a draft pull request; Codex does not review drafts."
    );
  });

  it("waits for every pull request when watching several at once", async () => {
    const secondPullRequest = parsePullRequestReference("yeager-j/pdx-ts-sdk#278");
    const completed: CodexReviewState = {
      pullRequest,
      status: "completed",
      commits: ["aaaaaaa"],
      findings: [],
    };
    let round = 0;
    let firstPullRequestLoads = 0;
    const output: string[] = [];

    await watchCodexReviews([pullRequest, secondPullRequest], {
      intervalMs: 1,
      loadState: async (current) => {
        if (current === pullRequest) {
          firstPullRequestLoads += 1;
          return completed;
        }
        return {
          ...completed,
          pullRequest: secondPullRequest,
          status: round === 0 ? "running" : "completed",
        };
      },
      sleep: async () => {
        round += 1;
      },
      write: (message) => output.push(message),
    });

    expect(round).toBe(1);
    expect(firstPullRequestLoads).toBe(1);
    expect(output).toHaveLength(2);
    expect(output[0]).toContain("pdx-ts-sdk#277");
    expect(output[0]).toContain("pdx-ts-sdk#278");
    expect(output[1]).toBe(
      "[yeager-j/pdx-ts-sdk#278] Codex review completed for aaaaaaa with no findings."
    );
  });

  it("rejects intervals that Node would coerce to a tight polling loop", async () => {
    await expect(
      watchCodexReviews([pullRequest], {
        intervalMs: Number.NaN,
        loadState: async () => ({
          pullRequest,
          status: "completed",
          commits: [],
          findings: [],
        }),
      })
    ).rejects.toThrow("Polling interval must be between");
    await expect(
      watchCodexReviews([pullRequest], {
        intervalMs: 0.5,
        loadState: async () => ({
          pullRequest,
          status: "completed",
          commits: [],
          findings: [],
        }),
      })
    ).rejects.toThrow("Polling interval must be between");
  });
});
