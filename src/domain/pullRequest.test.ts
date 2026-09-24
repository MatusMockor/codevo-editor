import { describe, expect, it } from "vitest";
import {
  classifyPullRequestError,
  parsePullRequestContext,
  parsePullRequestReceipt,
  pullRequestDraftDefaults,
  validatePullRequestBody,
  validatePullRequestTitle,
  type PullRequestContext,
} from "./pullRequest";

const context: PullRequestContext = {
  headBranch: "feat/idempotency-keys",
  defaultBase: "main",
  base: "main",
  commitsAhead: 3,
  filesChanged: 3,
  unpushedCommits: 2,
  hasUpstream: true,
  forge: "github",
  cliAvailable: true,
  commitSubjects: ["test(orders): cover retry", "feat(orders): replay responses"],
  compareUrl: "https://github.com/acme/orders-api/compare/main...feat/idempotency-keys?expand=1",
};

describe("pull request domain", () => {
  it("parses the context and receipt wire shapes exactly", () => {
    expect(parsePullRequestContext(context)).toEqual(context);
    expect(() => parsePullRequestContext({ ...context, token: "x" })).toThrow();
    expect(() => parsePullRequestContext({ ...context, forge: "bitbucket" })).toThrow();
    expect(() =>
      parsePullRequestContext({ ...context, compareUrl: "http://github.com/x" }),
    ).toThrow();
    expect(
      parsePullRequestReceipt({
        url: "https://github.com/acme/orders-api/pull/7",
        forge: "github",
      }),
    ).toEqual({
      url: "https://github.com/acme/orders-api/pull/7",
      forge: "github",
    });
    expect(() =>
      parsePullRequestReceipt({ url: "javascript:alert(1)", forge: "github" }),
    ).toThrow();
    expect(() =>
      parsePullRequestReceipt({
        url: "https://gitlab.com/acme/api/-/merge_requests/1",
        forge: "github",
      }),
    ).toThrow();
  });

  it("classifies prefixed backend errors and keeps an existing PR url", () => {
    expect(
      classifyPullRequestError(
        new Error("alreadyExists:https://github.com/acme/orders-api/pull/3"),
      ),
    ).toEqual({
      kind: "alreadyExists",
      message: "A pull request for this branch already exists.",
      url: "https://github.com/acme/orders-api/pull/3",
    });
    expect(
      classifyPullRequestError("cliMissing:Install the GitHub CLI (gh) to create pull requests."),
    ).toEqual({
      kind: "cliMissing",
      message: "Install the GitHub CLI (gh) to create pull requests.",
      url: null,
    });
    expect(classifyPullRequestError("alreadyExists:").url).toBeNull();
    expect(classifyPullRequestError("alreadyExists:javascript:alert(1)").url).toBeNull();
    expect(classifyPullRequestError(new Error("boom")).kind).toBe("forgeError");
    expect(classifyPullRequestError(42)).toEqual({
      kind: "forgeError",
      message: "The pull request could not be created.",
      url: null,
    });
  });

  it("validates title and body like the Rust side", () => {
    expect(validatePullRequestTitle("  Add keys ")).toEqual({ kind: "ok", title: "Add keys" });
    expect(validatePullRequestTitle(" ").kind).toBe("invalid");
    expect(validatePullRequestTitle("a\nb").kind).toBe("invalid");
    expect(validatePullRequestTitle("t".repeat(257)).kind).toBe("invalid");
    expect(validatePullRequestTitle("bidi \u202e title").kind).toBe("invalid");
    expect(validatePullRequestBody("## Why\n\tok\r\n")).toEqual({
      kind: "ok",
      body: "## Why\n\tok\r\n",
    });
    expect(validatePullRequestBody("b".repeat(65_537)).kind).toBe("invalid");
    expect(validatePullRequestBody("b".repeat(70 * 1024)).kind).toBe("invalid");
    expect(validatePullRequestBody("nul\u0000byte").kind).toBe("invalid");
    expect(validatePullRequestBody("bidi \u2066 body").kind).toBe("invalid");
  });

  it("rejects every bidi control at the edges of both ranges", () => {
    for (const control of ["\u202a", "\u202e", "\u2066", "\u2069"]) {
      expect(validatePullRequestTitle(`a${control}b`).kind).toBe("invalid");
      expect(validatePullRequestBody(`a${control}b`).kind).toBe("invalid");
    }
    expect(validatePullRequestTitle("a\u2065b").kind).toBe("ok");
  });

  it("drafts a title from the thread and a body from the commits", () => {
    expect(pullRequestDraftDefaults(context, "Idempotency keys for POST /orders")).toEqual({
      title: "Idempotency keys for POST /orders",
      body: "## Changes\n\n- feat(orders): replay responses\n- test(orders): cover retry\n",
    });
    expect(pullRequestDraftDefaults(context, null).title).toBe("feat(orders): replay responses");
    expect(pullRequestDraftDefaults({ ...context, commitSubjects: [] }, null)).toEqual({
      title: "feat/idempotency-keys",
      body: "",
    });
    expect(
      pullRequestDraftDefaults({ ...context, commitSubjects: [], headBranch: null }, "  "),
    ).toEqual({
      title: "",
      body: "",
    });
  });
});
