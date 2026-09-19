import { describe, expect, it } from "vitest";
import type { RemoteProjectSourceKind, RepositoryInfo } from "../domain/repositoryLookup";
import {
  boundedRemoteAddProjectError,
  INITIAL_REMOTE_ADD_PROJECT_STATE,
  planRemoteAddProjectEntry,
  reduceRemoteAddProject,
  remoteAddProjectCloneUrl,
  remoteAddProjectIdentity,
  type RemoteAddProjectAction,
  type RemoteAddProjectContext,
  type RemoteAddProjectLookupOutcome,
  type RemoteAddProjectSourceAvailability,
  type RemoteAddProjectState,
  type RemoteAddProjectStep,
} from "./remoteAddProjectMachine";

const githubRepository: RepositoryInfo = {
  provider: "github",
  host: "github.com",
  fullPath: "acme/storefront-api",
  description: "Storefront API service",
  visibility: "public",
  defaultBranch: "main",
  sshUrl: "git@github.com:acme/storefront-api.git",
  httpsUrl: "https://github.com/acme/storefront-api.git",
};

const httpsOnlyRepository: RepositoryInfo = {
  ...githubRepository,
  provider: "gitlab",
  host: "gitlab.example.com",
  fullPath: "platform/billing-service",
  sshUrl: null,
  httpsUrl: "https://gitlab.example.com/platform/billing-service.git",
};

const READY: RemoteAddProjectSourceAvailability = { status: "ready" };

function availability(
  overrides: Partial<Record<RemoteProjectSourceKind, RemoteAddProjectSourceAvailability>> = {},
): Readonly<Record<RemoteProjectSourceKind, RemoteAddProjectSourceAvailability>> {
  return { serverProject: READY, gitUrl: READY, github: READY, gitlab: READY, ...overrides };
}

const context: RemoteAddProjectContext = {
  serverProjects: [{ key: "project-1", label: "storefront-api" }],
  hosts: {
    github: [{ provider: "github", host: "github.com", auth: "authenticated" }],
    gitlab: [
      { provider: "gitlab", host: "gitlab.example.com", auth: "authenticated" },
      { provider: "gitlab", host: "gitlab.com", auth: "authenticated" },
    ],
  },
  hostsTruncated: { github: false, gitlab: false },
  availability: availability(),
};

const emptyContext: RemoteAddProjectContext = {
  serverProjects: [],
  hosts: { github: [], gitlab: [] },
  hostsTruncated: { github: false, gitlab: false },
  availability: availability(),
};

function run(
  actions: readonly RemoteAddProjectAction[],
  used: RemoteAddProjectContext = context,
  initial: RemoteAddProjectState = INITIAL_REMOTE_ADD_PROJECT_STATE,
): RemoteAddProjectState {
  return actions.reduce((state, action) => reduceRemoteAddProject(state, action, used), initial);
}

function confirmState(
  raw: string,
  source: "github" | "gitlab" | "gitUrl" = "github",
): RemoteAddProjectState {
  return run([{ kind: "open" }, { kind: "chooseSource", source }, { kind: "submitEntry", raw }]);
}

function lookedUpConfirm(outcome: RemoteAddProjectLookupOutcome): RemoteAddProjectState {
  return run([
    { kind: "open" },
    { kind: "chooseSource", source: "github" },
    { kind: "submitEntry", raw: "acme/storefront-api" },
    { kind: "lookupSettled", outcome },
  ]);
}

function lookedUpGitlabConfirm(outcome: RemoteAddProjectLookupOutcome): RemoteAddProjectState {
  return run([
    { kind: "open" },
    { kind: "chooseSource", source: "gitlab" },
    { kind: "submitEntry", raw: "platform/billing-service" },
    { kind: "lookupSettled", outcome },
  ]);
}

describe("remoteAddProjectMachine transitions", () => {
  it("opens on sources and closes back to the initial state", () => {
    expect(run([{ kind: "open" }])).toEqual({
      open: true,
      step: { kind: "sources" },
      previous: null,
    });
    expect(run([{ kind: "open" }, { kind: "close" }])).toBe(INITIAL_REMOTE_ADD_PROJECT_STATE);
    expect(run([{ kind: "open" }, { kind: "submitted" }])).toBe(INITIAL_REMOTE_ADD_PROJECT_STATE);
  });

  it("routes every source to its step", () => {
    const cases: readonly [RemoteAddProjectAction, RemoteAddProjectStep][] = [
      [{ kind: "chooseSource", source: "serverProject" }, { kind: "serverProjects" }],
      [
        { kind: "chooseSource", source: "gitUrl" },
        { kind: "urlEntry", entry: "", lookup: { status: "idle" } },
      ],
      [
        { kind: "chooseSource", source: "github" },
        {
          kind: "repository",
          provider: "github",
          host: "github.com",
          hosts: context.hosts.github,
          hostsTruncated: false,
          entry: "",
          lookup: { status: "idle" },
        },
      ],
      [
        { kind: "chooseSource", source: "gitlab" },
        {
          kind: "repository",
          provider: "gitlab",
          host: "gitlab.example.com",
          hosts: context.hosts.gitlab,
          hostsTruncated: false,
          entry: "",
          lookup: { status: "idle" },
        },
      ],
    ];

    for (const [action, step] of cases) {
      expect(run([{ kind: "open" }, action]).step).toEqual(step);
    }
  });

  it("falls back to the canonical host when no authenticated host is known", () => {
    const state = run([{ kind: "open" }, { kind: "chooseSource", source: "gitlab" }], emptyContext);
    expect(state.step).toEqual({
      kind: "repository",
      provider: "gitlab",
      host: "gitlab.com",
      hosts: [],
      hostsTruncated: false,
      entry: "",
      lookup: { status: "idle" },
    });
  });

  it("ignores a source choice while the dialog is closed or past the sources step", () => {
    const closed = run([{ kind: "chooseSource", source: "github" }]);
    expect(closed).toBe(INITIAL_REMOTE_ADD_PROJECT_STATE);
    const opened = run([{ kind: "open" }, { kind: "chooseSource", source: "github" }]);
    expect(
      reduceRemoteAddProject(opened, { kind: "chooseSource", source: "gitUrl" }, context),
    ).toBe(opened);
  });

  it("switches hosts only to a known host and resets the lookup", () => {
    const pending = run([
      { kind: "open" },
      { kind: "chooseSource", source: "gitlab" },
      { kind: "submitEntry", raw: "platform/billing-service" },
    ]);
    expect(
      reduceRemoteAddProject(pending, { kind: "chooseHost", host: "evil.test" }, context),
    ).toBe(pending);
    const switched = reduceRemoteAddProject(
      pending,
      { kind: "chooseHost", host: "gitlab.com" },
      context,
    );
    expect(switched.step).toMatchObject({ host: "gitlab.com", lookup: { status: "idle" } });
  });

  it("goes back one step and closes from the sources step", () => {
    const repository = run([{ kind: "open" }, { kind: "chooseSource", source: "github" }]);
    expect(reduceRemoteAddProject(repository, { kind: "back" }, context).step).toEqual({
      kind: "sources",
    });
    const confirm = confirmState("git@github.com:acme/storefront-api.git");
    const back = reduceRemoteAddProject(confirm, { kind: "back" }, context);
    expect(back.step).toMatchObject({ kind: "repository", provider: "github" });
    expect(reduceRemoteAddProject(back, { kind: "back" }, context).step).toEqual({
      kind: "sources",
    });
    const sources = run([{ kind: "open" }]);
    expect(reduceRemoteAddProject(sources, { kind: "back" }, context)).toBe(sources);
  });

  it("keeps a url candidate reachable from the url entry step only through a clone url", () => {
    const rejected = run([
      { kind: "open" },
      { kind: "chooseSource", source: "gitUrl" },
      { kind: "submitEntry", raw: "acme/storefront-api" },
    ]);
    expect(rejected.step).toEqual({
      kind: "urlEntry",
      entry: "acme/storefront-api",
      lookup: { status: "rejectedInput", reason: "invalidUrl" },
    });
    const accepted = confirmState("git@github.com:acme/storefront-api.git", "gitUrl");
    expect(accepted.step).toMatchObject({
      kind: "confirm",
      candidate: {
        kind: "url",
        url: "git@github.com:acme/storefront-api.git",
        identity: { host: "github.com", path: "acme/storefront-api" },
      },
      name: "storefront-api",
      branch: "",
      protocol: "ssh",
      nameError: null,
      branchError: null,
      existingProjectKey: "project-1",
      submitError: null,
      submitting: false,
    });
  });

  it("skips the lookup when the repository step receives a clone url", () => {
    const state = confirmState("https://github.com/acme/storefront-api.git");
    expect(state.step).toMatchObject({ kind: "confirm", protocol: "https" });
    expect(
      planRemoteAddProjectEntry(
        {
          kind: "repository",
          provider: "github",
          host: "github.com",
          hosts: context.hosts.github,
          hostsTruncated: false,
          entry: "",
          lookup: { status: "idle" },
        },
        "https://github.com/acme/storefront-api.git",
        context,
      ),
    ).toEqual({
      kind: "candidate",
      candidate: {
        kind: "url",
        url: "https://github.com/acme/storefront-api.git",
        identity: { host: "github.com", path: "acme/storefront-api" },
      },
    });
  });

  it("rejects an unparseable repository path before any lookup", () => {
    const state = run([
      { kind: "open" },
      { kind: "chooseSource", source: "github" },
      { kind: "submitEntry", raw: "acme/team/storefront-api" },
    ]);
    expect(state.step).toMatchObject({
      kind: "repository",
      lookup: { status: "rejectedInput", reason: "invalidPath" },
    });
  });

  it("plans a normalized lookup request for a valid path", () => {
    expect(
      planRemoteAddProjectEntry(
        {
          kind: "repository",
          provider: "gitlab",
          host: "gitlab.example.com",
          hosts: context.hosts.gitlab,
          hostsTruncated: false,
          entry: "",
          lookup: { status: "idle" },
        },
        "  platform/billing-service.git  ",
        context,
      ),
    ).toEqual({
      kind: "lookup",
      request: {
        provider: "gitlab",
        host: "gitlab.example.com",
        path: "platform/billing-service",
      },
    });
    expect(planRemoteAddProjectEntry({ kind: "sources" }, "anything", context)).toEqual({
      kind: "ignored",
    });
  });

  it("settles every lookup outcome status", () => {
    const outcomes: readonly RemoteAddProjectLookupOutcome[] = [
      { status: "notFound" },
      { status: "cliMissing" },
      { status: "notAuthenticated" },
      { status: "hostNotAllowed" },
      { status: "timedOut" },
      { status: "rateLimited", retryAfterSeconds: 30 },
      { status: "rateLimited", retryAfterSeconds: null },
      { status: "failed", reason: "network" },
      { status: "failed", reason: "invalidOutput" },
      { status: "failed", reason: "outputTooLarge" },
      { status: "failed", reason: "busy" },
      { status: "failed", reason: "unknown" },
    ];

    for (const outcome of outcomes) {
      expect(lookedUpConfirm(outcome).step).toMatchObject({
        kind: "repository",
        lookup: { status: "settled", outcome },
      });
    }
  });

  it("ignores an identical entry submit while its lookup is still pending", () => {
    const pending = run([
      { kind: "open" },
      { kind: "chooseSource", source: "github" },
      { kind: "submitEntry", raw: "acme/storefront-api" },
    ]);
    expect(pending.step).toMatchObject({
      lookup: {
        status: "pending",
        request: { provider: "github", host: "github.com", path: "acme/storefront-api" },
      },
    });

    expect(
      planRemoteAddProjectEntry(pending.step, "  acme/storefront-api  ", context),
    ).toMatchObject({ kind: "ignored" });
    expect(
      reduceRemoteAddProject(
        pending,
        { kind: "submitEntry", raw: "  acme/storefront-api  " },
        context,
      ),
    ).toBe(pending);
  });

  it("supersedes a pending lookup when a different entry is submitted", () => {
    const pending = run([
      { kind: "open" },
      { kind: "chooseSource", source: "github" },
      { kind: "submitEntry", raw: "acme/storefront-api" },
    ]);

    const plan = planRemoteAddProjectEntry(pending.step, "acme/checkout-api", context);
    expect(plan).toEqual({
      kind: "lookup",
      request: { provider: "github", host: "github.com", path: "acme/checkout-api" },
    });
    const next = reduceRemoteAddProject(
      pending,
      { kind: "submitEntry", raw: "acme/checkout-api" },
      context,
    );
    expect(next.step).toMatchObject({
      entry: "acme/checkout-api",
      lookup: { status: "pending", request: { path: "acme/checkout-api" } },
    });
  });

  it("settles a repository without any clone URL instead of entering confirm", () => {
    const state = lookedUpConfirm({
      status: "ok",
      repository: { ...githubRepository, sshUrl: null, httpsUrl: null },
    });

    expect(state.step).toMatchObject({
      kind: "repository",
      lookup: { status: "settled", outcome: { status: "noCloneUrl" } },
    });
  });

  it("ignores a foreign settle after the lookup already settled", () => {
    const settled = lookedUpConfirm({ status: "notFound" });
    expect(
      reduceRemoteAddProject(
        settled,
        { kind: "lookupSettled", outcome: { status: "timedOut" } },
        context,
      ),
    ).toBe(settled);
  });

  it("enters confirm with contract defaults after a successful lookup", () => {
    const state = lookedUpConfirm({ status: "ok", repository: githubRepository });
    expect(state.step).toEqual({
      kind: "confirm",
      candidate: { kind: "repository", repository: githubRepository },
      name: "storefront-api",
      branch: "",
      protocol: "ssh",
      nameError: null,
      branchError: null,
      existingProjectKey: "project-1",
      submitError: null,
      submitting: false,
    });
  });

  it("defaults to https when the repository has no ssh url", () => {
    const state = lookedUpGitlabConfirm({ status: "ok", repository: httpsOnlyRepository });
    expect(state.step).toMatchObject({ protocol: "https", name: "billing-service" });
  });

  it("marks an unusable folder name invalid and clears it when corrected", () => {
    const state = lookedUpConfirm({
      status: "ok",
      repository: { ...githubRepository, fullPath: "acme/_storefront" },
    });
    expect(state.step).toMatchObject({ name: "", nameError: "invalid" });
    const named = reduceRemoteAddProject(state, { kind: "setName", value: "-nope" }, context);
    expect(named.step).toMatchObject({ nameError: "invalid" });
    const fixed = reduceRemoteAddProject(
      named,
      { kind: "setName", value: "storefront-api" },
      context,
    );
    expect(fixed.step).toMatchObject({ nameError: null, existingProjectKey: "project-1" });
  });

  it("matches an existing server project by exact label only", () => {
    const state = lookedUpConfirm({ status: "ok", repository: githubRepository });
    const renamed = reduceRemoteAddProject(
      state,
      { kind: "setName", value: "Storefront-API" },
      context,
    );
    expect(renamed.step).toMatchObject({ existingProjectKey: null });
  });

  it("recomputes the existing project on syncContext without churning identity", () => {
    const state = lookedUpConfirm({ status: "ok", repository: githubRepository });
    expect(reduceRemoteAddProject(state, { kind: "syncContext" }, context)).toBe(state);
    const dropped = reduceRemoteAddProject(state, { kind: "syncContext" }, emptyContext);
    expect(dropped.step).toMatchObject({ existingProjectKey: null });
  });

  it("adopts new hosts on syncContext and keeps the pending lookup when the host survives", () => {
    const pending = run([
      { kind: "open" },
      { kind: "chooseSource", source: "gitlab" },
      { kind: "submitEntry", raw: "platform/billing-service" },
    ]);
    expect(reduceRemoteAddProject(pending, { kind: "syncContext" }, context)).toBe(pending);
    const sameHosts: RemoteAddProjectContext = {
      ...context,
      hosts: { github: context.hosts.github, gitlab: [...context.hosts.gitlab] },
    };
    const kept = reduceRemoteAddProject(pending, { kind: "syncContext" }, sameHosts);
    expect(kept.step).toMatchObject({ host: "gitlab.example.com", lookup: { status: "pending" } });
    const moved = reduceRemoteAddProject(pending, { kind: "syncContext" }, emptyContext);
    expect(moved.step).toMatchObject({ host: "gitlab.com", lookup: { status: "idle" } });
  });

  it("changes branch and protocol only when the protocol has a url", () => {
    const state = lookedUpConfirm({ status: "ok", repository: githubRepository });
    const branch = reduceRemoteAddProject(state, { kind: "setBranch", value: "main" }, context);
    expect(branch.step).toMatchObject({ branch: "main" });
    const https = reduceRemoteAddProject(branch, { kind: "setProtocol", value: "https" }, context);
    expect(https.step).toMatchObject({ protocol: "https" });
    const noSsh = lookedUpGitlabConfirm({ status: "ok", repository: httpsOnlyRepository });
    expect(reduceRemoteAddProject(noSsh, { kind: "setProtocol", value: "ssh" }, context)).toBe(
      noSsh,
    );
  });

  it("locks the form while submitting and restores it on failure", () => {
    const state = lookedUpConfirm({ status: "ok", repository: githubRepository });
    const submitting = reduceRemoteAddProject(state, { kind: "submitStarted" }, context);
    expect(submitting.step).toMatchObject({ submitting: true, submitError: null });
    expect(reduceRemoteAddProject(submitting, { kind: "setName", value: "other" }, context)).toBe(
      submitting,
    );
    const failed = reduceRemoteAddProject(
      submitting,
      { kind: "submitFailed", error: "x".repeat(400), nameConflict: false },
      context,
    );
    expect(failed.step).toMatchObject({ submitting: false });
    const step = failed.step;
    expect(step.kind === "confirm" && step.submitError?.length).toBe(200);
  });

  it("maps a runner name conflict to a taken folder name", () => {
    const state = lookedUpConfirm({ status: "ok", repository: githubRepository });
    const submitting = reduceRemoteAddProject(state, { kind: "submitStarted" }, context);
    const taken = reduceRemoteAddProject(
      submitting,
      { kind: "submitFailed", error: "Runner request failed (HTTP 409).", nameConflict: true },
      context,
    );
    expect(taken.step).toMatchObject({ nameError: "taken", submitError: null, submitting: false });
    const retyped = reduceRemoteAddProject(
      taken,
      { kind: "setName", value: "storefront-2" },
      context,
    );
    expect(retyped.step).toMatchObject({ nameError: null });
  });

  it("refuses to submit an invalid folder name", () => {
    const state = lookedUpConfirm({
      status: "ok",
      repository: { ...githubRepository, fullPath: "acme/_storefront" },
    });
    expect(reduceRemoteAddProject(state, { kind: "submitStarted" }, context)).toBe(state);
  });

  it("ignores confirm actions outside the confirm step", () => {
    const sources = run([{ kind: "open" }]);
    const actions: readonly RemoteAddProjectAction[] = [
      { kind: "setName", value: "x" },
      { kind: "setBranch", value: "x" },
      { kind: "setProtocol", value: "https" },
      { kind: "submitStarted" },
      { kind: "submitFailed", error: "x", nameConflict: false },
      { kind: "chooseHost", host: "github.com" },
    ];
    for (const action of actions) {
      expect(reduceRemoteAddProject(sources, action, context)).toBe(sources);
    }
  });

  it("moves from a repository step to url entry through useGitUrl", () => {
    const repository = run([{ kind: "open" }, { kind: "chooseSource", source: "github" }]);
    expect(repository.step.kind).toBe("repository");
    const url = reduceRemoteAddProject(repository, { kind: "useGitUrl" }, context);
    expect(url.step).toEqual({ kind: "urlEntry", entry: "", lookup: { status: "idle" } });
    const failed = run([
      { kind: "open" },
      { kind: "chooseSource", source: "github" },
      { kind: "submitEntry", raw: "acme/storefront-api" },
      { kind: "lookupSettled", outcome: { status: "notFound" } },
    ]);
    expect(reduceRemoteAddProject(failed, { kind: "useGitUrl" }, context).step).toMatchObject({
      kind: "urlEntry",
      lookup: { status: "idle" },
    });
  });

  it("refuses useGitUrl while the git url source is unavailable", () => {
    const blocked: RemoteAddProjectContext = {
      ...context,
      availability: availability({
        gitUrl: { status: "unavailable", reason: "cloningUnsupported" },
      }),
    };
    const repository = run([{ kind: "open" }, { kind: "chooseSource", source: "github" }], blocked);
    expect(reduceRemoteAddProject(repository, { kind: "useGitUrl" }, blocked)).toBe(repository);
  });

  it("refuses an unavailable source and its entry", () => {
    const blocked: RemoteAddProjectContext = {
      ...context,
      availability: availability({
        github: { status: "unavailable", reason: "notAuthenticated" },
        gitlab: { status: "checking" },
      }),
    };
    const opened = run([{ kind: "open" }], blocked);
    for (const source of ["github", "gitlab"] as const) {
      expect(reduceRemoteAddProject(opened, { kind: "chooseSource", source }, blocked)).toBe(
        opened,
      );
    }
    const reachable = run([{ kind: "open" }, { kind: "chooseSource", source: "github" }]);
    expect(planRemoteAddProjectEntry(reachable.step, "acme/storefront-api", blocked)).toEqual({
      kind: "ignored",
    });
    expect(reduceRemoteAddProject(reachable, { kind: "submitEntry", raw: "acme/x" }, blocked)).toBe(
      reachable,
    );
  });

  it("refuses a lookup against a host outside the authenticated list", () => {
    const foreign = run(
      [{ kind: "open" }, { kind: "chooseSource", source: "gitlab" }],
      emptyContext,
    );
    expect(foreign.step).toMatchObject({ host: "gitlab.com", hosts: [] });
    expect(
      planRemoteAddProjectEntry(foreign.step, "platform/billing-service", emptyContext),
    ).toEqual({ kind: "ignored" });
  });

  it("refuses an ok outcome whose repository is not the requested one", () => {
    const foreignHost = lookedUpConfirm({
      status: "ok",
      repository: { ...githubRepository, host: "ghe.example.com" },
    });
    expect(foreignHost.step).toMatchObject({
      kind: "repository",
      lookup: { status: "settled", outcome: { status: "failed", reason: "invalidOutput" } },
    });
    const foreignProvider = lookedUpConfirm({ status: "ok", repository: httpsOnlyRepository });
    expect(foreignProvider.step).toMatchObject({
      kind: "repository",
      lookup: { status: "settled", outcome: { status: "failed", reason: "invalidOutput" } },
    });
  });

  it("keeps close and back out of a submitting confirm step", () => {
    const state = lookedUpConfirm({ status: "ok", repository: githubRepository });
    const submitting = reduceRemoteAddProject(state, { kind: "submitStarted" }, context);
    expect(reduceRemoteAddProject(submitting, { kind: "close" }, context)).toBe(submitting);
    expect(reduceRemoteAddProject(submitting, { kind: "back" }, context)).toBe(submitting);
    const failed = reduceRemoteAddProject(
      submitting,
      { kind: "submitFailed", error: "runner unreachable", nameConflict: false },
      context,
    );
    expect(failed.step).toMatchObject({ submitError: "runner unreachable", submitting: false });
    expect(reduceRemoteAddProject(failed, { kind: "close" }, context)).toBe(
      INITIAL_REMOTE_ADD_PROJECT_STATE,
    );
  });

  it("rejects a branch outside the runner grammar and blocks the submit", () => {
    const state = lookedUpConfirm({ status: "ok", repository: githubRepository });
    const invalid = reduceRemoteAddProject(state, { kind: "setBranch", value: "a..b" }, context);
    expect(invalid.step).toMatchObject({ branchError: "invalid" });
    expect(reduceRemoteAddProject(invalid, { kind: "submitStarted" }, context)).toBe(invalid);
    const empty = reduceRemoteAddProject(invalid, { kind: "setBranch", value: "  " }, context);
    expect(empty.step).toMatchObject({ branchError: null });
    const valid = reduceRemoteAddProject(
      invalid,
      { kind: "setBranch", value: " release/2026.04 " },
      context,
    );
    expect(valid.step).toMatchObject({ branchError: null });
    expect(reduceRemoteAddProject(valid, { kind: "submitStarted" }, context).step).toMatchObject({
      submitting: true,
    });
  });

  it("remembers the entered repository text when returning from confirm", () => {
    const confirm = run([
      { kind: "open" },
      { kind: "chooseSource", source: "github" },
      { kind: "submitEntry", raw: "git@github.com:acme/storefront-api.git" },
    ]);
    const back = reduceRemoteAddProject(confirm, { kind: "back" }, context);
    expect(back.step).toMatchObject({
      kind: "repository",
      entry: "git@github.com:acme/storefront-api.git",
      lookup: { status: "idle" },
    });
  });

  it("bounds the remembered entry text", () => {
    const long = `acme/${"a".repeat(4000)}`;
    const state = run([
      { kind: "open" },
      { kind: "chooseSource", source: "gitUrl" },
      { kind: "submitEntry", raw: long },
    ]);
    const step = state.step;
    expect(step.kind === "urlEntry" && step.entry.length).toBe(2048);
  });

  it("carries the truncated host flag into the repository step", () => {
    const truncated: RemoteAddProjectContext = {
      ...context,
      hostsTruncated: { github: false, gitlab: true },
    };
    const state = run([{ kind: "open" }, { kind: "chooseSource", source: "gitlab" }], truncated);
    expect(state.step).toMatchObject({ hostsTruncated: true });
  });

  it("rejects an unknown action", () => {
    expect(() =>
      reduceRemoteAddProject(
        INITIAL_REMOTE_ADD_PROJECT_STATE,
        { kind: "teleport" } as unknown as RemoteAddProjectAction,
        context,
      ),
    ).toThrow(/Unsupported remote add-project action/u);
  });
});

describe("remoteAddProjectMachine helpers", () => {
  it("selects a clone url per protocol and candidate", () => {
    expect(
      remoteAddProjectCloneUrl({ kind: "repository", repository: githubRepository }, "ssh"),
    ).toBe("git@github.com:acme/storefront-api.git");
    expect(
      remoteAddProjectCloneUrl({ kind: "repository", repository: httpsOnlyRepository }, "ssh"),
    ).toBeNull();
    const url = {
      kind: "url",
      url: "git@github.com:acme/storefront-api.git",
      identity: { host: "github.com", path: "acme/storefront-api" },
    } as const;
    expect(remoteAddProjectCloneUrl(url, "ssh")).toBe(url.url);
    expect(remoteAddProjectCloneUrl(url, "https")).toBeNull();
  });

  it("derives the identity of both candidate kinds", () => {
    expect(remoteAddProjectIdentity({ kind: "repository", repository: githubRepository })).toEqual({
      host: "github.com",
      path: "acme/storefront-api",
    });
    expect(
      remoteAddProjectIdentity({
        kind: "url",
        url: "git@github.com:acme/storefront-api.git",
        identity: { host: "github.com", path: "acme/storefront-api" },
      }),
    ).toEqual({ host: "github.com", path: "acme/storefront-api" });
  });

  it("bounds and sanitizes display errors", () => {
    expect(boundedRemoteAddProjectError("  clone failed\n\u0007  ")).toBe("clone failed");
    expect(boundedRemoteAddProjectError("\u0000")).toBe("Could not clone the repository.");
    expect(boundedRemoteAddProjectError("y".repeat(500)).length).toBe(200);
  });
});
