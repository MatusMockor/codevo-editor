// @vitest-environment jsdom

import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type {
  CreatePullRequestRequest,
  PullRequestContext,
  PullRequestContextRequest,
  PullRequestGateway,
  PullRequestReceipt,
} from "../../domain/pullRequest";
import type { GitSurfaceTarget } from "../../domain/gitSurfaceStatus";
import { waitForReact } from "../../test/reactTestLifecycle";
import { mountUi, type MountedUi } from "../../ui/foundation/foundationTestSupport";
import {
  useAgentPullRequest,
  type AgentPullRequestState,
  type UseAgentPullRequestOptions,
} from "./useAgentPullRequest";

let ui: MountedUi | null = null;
const box: { current: AgentPullRequestState | null } = { current: null };

afterEach(() => {
  ui?.unmount();
  ui = null;
  box.current = null;
});

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function context(overrides: Partial<PullRequestContext> = {}): PullRequestContext {
  return {
    headBranch: "feat/idempotency-keys",
    defaultBase: "main",
    base: "main",
    commitsAhead: 3,
    filesChanged: 3,
    unpushedCommits: 2,
    hasUpstream: true,
    forge: "github",
    cliAvailable: true,
    commitSubjects: ["feat: add middleware", "test: cover retries"],
    compareUrl: "https://github.com/acme/orders-api/compare/main...feat/idempotency-keys",
    ...overrides,
  };
}

const RECEIPT: PullRequestReceipt = {
  url: "https://github.com/acme/orders-api/pull/4",
  forge: "github",
};

function scriptedGateway() {
  const contexts: Array<{
    request: PullRequestContextRequest;
    result: Deferred<PullRequestContext>;
  }> = [];
  const creates: Array<{
    request: CreatePullRequestRequest;
    result: Deferred<PullRequestReceipt>;
  }> = [];
  const gateway: PullRequestGateway = {
    getContext(request) {
      const result = deferred<PullRequestContext>();
      contexts.push({ request, result });
      return result.promise;
    },
    create(request) {
      const result = deferred<PullRequestReceipt>();
      creates.push({ request, result });
      return result.promise;
    },
  };
  return { contexts, creates, gateway };
}

const TARGET_A: GitSurfaceTarget = { repositoryRoot: "/a", worktreePath: "/a/.worktrees/t" };
const TARGET_B: GitSurfaceTarget = { repositoryRoot: "/b", worktreePath: null };

function Probe(props: { readonly options: UseAgentPullRequestOptions }) {
  box.current = useAgentPullRequest(props.options);
  return null;
}

function render(options: UseAgentPullRequestOptions): void {
  ui = ui ?? mountUi();
  ui.render(<Probe options={options} />);
}

function state(): AgentPullRequestState {
  expect(box.current).not.toBeNull();
  return box.current as AgentPullRequestState;
}

async function loaded(fake: ReturnType<typeof scriptedGateway>, index: number, value = context()) {
  await act(async () => fake.contexts[index]?.result.resolve(value));
}

describe("useAgentPullRequest", () => {
  it("loads the context and fills the form defaults", async () => {
    const fake = scriptedGateway();
    render({
      ownerKey: "a",
      target: TARGET_A,
      gateway: fake.gateway,
      threadTitle: "Replay responses",
    });

    expect(state().context).toEqual({ kind: "loading" });
    expect(fake.contexts[0]?.request).toEqual({ ...TARGET_A, base: null });
    await loaded(fake, 0);

    expect(state().context).toEqual({ kind: "ready", value: context() });
    expect(state().title).toBe("Replay responses");
    expect(state().body).toBe("## Changes\n\n- test: cover retries\n- feat: add middleware\n");
    expect(state().base).toBe("main");
    expect(state().draft).toBe(false);
  });

  it("keeps an edited title when the context reloads for another base", async () => {
    const fake = scriptedGateway();
    render({ ownerKey: "a", target: TARGET_A, gateway: fake.gateway, threadTitle: null });
    await loaded(fake, 0);

    act(() => state().setTitle("My own title"));
    act(() => state().setBase("develop"));

    expect(fake.contexts[1]?.request).toEqual({ ...TARGET_A, base: "develop" });
    await loaded(fake, 1, context({ base: "develop", commitSubjects: ["other"] }));
    expect(state().title).toBe("My own title");
    expect(state().base).toBe("develop");
  });

  it("rejects hostile titles, bodies and bases without calling the gateway", async () => {
    const fake = scriptedGateway();
    render({ ownerKey: "a", target: TARGET_A, gateway: fake.gateway, threadTitle: null });
    await loaded(fake, 0);

    act(() => state().setTitle("Line one\nline two"));
    act(() => state().create());
    expect(state().titleError).not.toBeNull();

    act(() => state().setTitle("   "));
    act(() => state().create());
    expect(state().titleError).toBe("Enter a pull request title.");

    act(() => state().setTitle("Fine"));
    act(() => state().setBody("x".repeat(70_000)));
    act(() => state().create());
    expect(state().titleError).toBeNull();
    expect(state().bodyError).toBe("The description is too long.");

    act(() => state().setBody("ok"));
    for (const hostile of ["--help", "a..b"]) {
      act(() => state().setBase(hostile));
      expect(state().baseError).toBe("Choose a valid base branch.");
      expect(state().base).toBe("main");
    }

    expect(fake.creates).toEqual([]);
    expect(fake.contexts).toHaveLength(1);
  });

  it("creates the pull request with the validated form", async () => {
    const fake = scriptedGateway();
    render({ ownerKey: "a", target: TARGET_A, gateway: fake.gateway, threadTitle: "Title" });
    await loaded(fake, 0);
    act(() => state().setDraft(true));

    act(() => state().create());
    expect(state().submit).toEqual({ kind: "submitting" });
    expect(fake.creates[0]?.request).toEqual({
      ...TARGET_A,
      base: "main",
      title: "Title",
      body: "## Changes\n\n- test: cover retries\n- feat: add middleware\n",
      draft: true,
    });
    await act(async () => fake.creates[0]?.result.resolve(RECEIPT));

    expect(state().submit).toEqual({ kind: "created", receipt: RECEIPT });
  });

  it("classifies an existing pull request with its url", async () => {
    const fake = scriptedGateway();
    render({ ownerKey: "a", target: TARGET_A, gateway: fake.gateway, threadTitle: "Title" });
    await loaded(fake, 0);

    act(() => state().create());
    await act(async () =>
      fake.creates[0]?.result.reject(
        new Error("alreadyExists:https://github.com/acme/orders-api/pull/3"),
      ),
    );

    expect(state().submit).toEqual({
      kind: "failed",
      failure: {
        kind: "alreadyExists",
        message: "A pull request for this branch already exists.",
        url: "https://github.com/acme/orders-api/pull/3",
      },
    });
  });

  it("keeps a late receipt for its owner and shows it when the owner returns", async () => {
    const fake = scriptedGateway();
    render({ ownerKey: "a", target: TARGET_A, gateway: fake.gateway, threadTitle: "Title A" });
    await loaded(fake, 0);
    act(() => state().create());
    expect(state().submit).toEqual({ kind: "submitting" });

    render({ ownerKey: "b", target: TARGET_B, gateway: fake.gateway, threadTitle: "Title B" });
    expect(state().submit).toEqual({ kind: "idle" });
    await act(async () => fake.creates[0]?.result.resolve(RECEIPT));
    expect(state().submit).toEqual({ kind: "idle" });

    render({ ownerKey: "a", target: TARGET_A, gateway: fake.gateway, threadTitle: "Title A" });
    expect(state().submit).toEqual({ kind: "created", receipt: RECEIPT });
    await loaded(fake, 2);
    expect(state().context).toEqual({ kind: "ready", value: context() });
    expect(state().submit).toEqual({ kind: "created", receipt: RECEIPT });

    act(() => state().create());
    expect(fake.creates).toHaveLength(1);
  });

  it("forgets a created pull request once the head branch changed", async () => {
    const fake = scriptedGateway();
    render({ ownerKey: "a", target: TARGET_A, gateway: fake.gateway, threadTitle: "Title A" });
    await loaded(fake, 0);
    act(() => state().create());
    await act(async () => fake.creates[0]?.result.resolve(RECEIPT));
    expect(state().submit.kind).toBe("created");

    act(() => state().reload());
    await loaded(fake, 1, context({ headBranch: "feat/next" }));

    expect(state().submit).toEqual({ kind: "idle" });
  });

  it("drops a late context of the previous owner", async () => {
    const fake = scriptedGateway();
    render({ ownerKey: "a", target: TARGET_A, gateway: fake.gateway, threadTitle: "Title A" });
    render({ ownerKey: "b", target: TARGET_B, gateway: fake.gateway, threadTitle: "Title B" });

    await loaded(fake, 0, context({ headBranch: "from-a" }));
    expect(state().context).toEqual({ kind: "loading" });
    await loaded(fake, 1, context({ headBranch: "from-b" }));
    await waitForReact(() => expect(state().title).toBe("Title B"));
    expect(state().context).toMatchObject({ kind: "ready", value: { headBranch: "from-b" } });
  });

  it("stays idle without a target and never calls the gateway", () => {
    const fake = scriptedGateway();
    render({ ownerKey: null, target: null, gateway: fake.gateway, threadTitle: null });

    act(() => state().create());

    expect(state().context).toEqual({ kind: "idle" });
    expect(state().submit).toEqual({ kind: "idle" });
    expect(fake.contexts).toEqual([]);
    expect(fake.creates).toEqual([]);
  });

  it("requires a base branch when none is known", async () => {
    const fake = scriptedGateway();
    render({ ownerKey: "a", target: TARGET_A, gateway: fake.gateway, threadTitle: "Title" });
    await loaded(fake, 0, context({ base: null, defaultBase: null }));

    act(() => state().create());

    expect(state().baseError).toBe("Choose a base branch.");
    expect(fake.creates).toEqual([]);
  });

  it("reports a failed context load", async () => {
    const fake = scriptedGateway();
    render({ ownerKey: "a", target: TARGET_A, gateway: fake.gateway, threadTitle: null });
    await act(async () => fake.contexts[0]?.result.reject(new Error("untrusted:Trust it first")));

    expect(state().context).toEqual({ kind: "failed", message: "Trust it first" });
  });
});
