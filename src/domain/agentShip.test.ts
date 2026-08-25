import { describe, expect, it } from "vitest";
import { utf8ByteLength } from "./agentOutput/utf8Text";
import {
  MAX_AGENT_SHIP_COMMIT_MESSAGE_BYTES,
  MAX_AGENT_SHIP_FAILURE_BYTES,
  agentShipReducer,
  agentShipStatus,
  agentShipTransitionAllowed,
  initialAgentShipState,
  isAgentShipBusy,
  type AgentShipAction,
  type AgentShipState,
} from "./agentShip";
import { MAX_GIT_INTEGRATION_CONFLICT_FILES, type GitShipStatus } from "./gitIntegration";

const COMMIT_SHA = "a".repeat(40);
const NEXT_SHA = "b".repeat(40);
const MERGE_SHA = "c".repeat(40);

function shipStatus(overrides: Partial<GitShipStatus> = {}): GitShipStatus {
  return {
    worktree: { branch: "agent/agt-0001", head: COMMIT_SHA, dirty: true, changeCount: 2 },
    primary: { branch: "main", head: NEXT_SHA, dirty: false },
    relation: { aheadOfPrimary: 1, behindPrimary: 0, fastForwardable: true },
    remote: { name: "origin", upstream: { ahead: 0, behind: 0 }, compareUrl: null },
    ...overrides,
  };
}

const STATUS = shipStatus();
const FRESH_STATUS = shipStatus({
  worktree: { branch: "agent/agt-0001", head: NEXT_SHA, dirty: false, changeCount: 0 },
});

const RECEIPT = { remote: "origin", branch: "agent/agt-0001", compareUrl: null } as const;

const STATES: ReadonlyArray<{ readonly name: string; readonly state: AgentShipState }> = [
  { name: "idle", state: { kind: "idle", status: null, loadingStatus: false } },
  { name: "idleLoading", state: { kind: "idle", status: STATUS, loadingStatus: true } },
  {
    name: "committing",
    state: { kind: "committing", status: STATUS, message: "Work", resumeFrom: "idle" },
  },
  { name: "committed", state: { kind: "committed", status: STATUS, commitSha: COMMIT_SHA } },
  {
    name: "pushing",
    state: { kind: "pushing", status: STATUS, commitSha: COMMIT_SHA, resumeFrom: "committed" },
  },
  { name: "pushed", state: { kind: "pushed", status: STATUS, receipt: RECEIPT } },
  {
    name: "integrating",
    state: { kind: "integrating", status: STATUS, mode: "merge", resumeFrom: "committed" },
  },
  {
    name: "integrated",
    state: { kind: "integrated", status: STATUS, mergeSha: MERGE_SHA, intoBranch: "main" },
  },
  {
    name: "removingWorktree",
    state: {
      kind: "removingWorktree",
      status: STATUS,
      deleteBranch: true,
      resumeFrom: "integrated",
    },
  },
  { name: "worktreeRemoved", state: { kind: "worktreeRemoved", branchDeleted: false } },
  {
    name: "failed",
    state: {
      kind: "failed",
      status: STATUS,
      failure: { step: "push", reason: "rejected", message: "rejected" },
      resumeFrom: "committed",
    },
  },
];

const ACTIONS: ReadonlyArray<{ readonly name: string; readonly action: AgentShipAction }> = [
  { name: "statusRequested", action: { kind: "statusRequested" } },
  { name: "statusLoaded", action: { kind: "statusLoaded", status: FRESH_STATUS } },
  { name: "statusFailed", action: { kind: "statusFailed", message: "boom" } },
  { name: "commitStarted", action: { kind: "commitStarted", message: "Work" } },
  {
    name: "commitSucceeded",
    action: { kind: "commitSucceeded", commitSha: NEXT_SHA, status: FRESH_STATUS },
  },
  { name: "pushStarted", action: { kind: "pushStarted" } },
  {
    name: "pushSucceeded",
    action: { kind: "pushSucceeded", receipt: RECEIPT, status: FRESH_STATUS },
  },
  { name: "integrateStarted", action: { kind: "integrateStarted", mode: "merge" } },
  {
    name: "integrateSucceeded",
    action: {
      kind: "integrateSucceeded",
      mergeSha: MERGE_SHA,
      intoBranch: "main",
      status: FRESH_STATUS,
    },
  },
  { name: "removeStarted", action: { kind: "removeStarted", deleteBranch: true } },
  { name: "removeSucceeded", action: { kind: "removeSucceeded", branchDeleted: true } },
  {
    name: "stepFailed",
    action: {
      kind: "stepFailed",
      failure: { step: "commit", reason: "gitError", message: "bad" },
    },
  },
  { name: "reset", action: { kind: "reset" } },
];

const NON_BUSY_ACCEPTED = [
  "statusLoaded",
  "commitStarted",
  "pushStarted",
  "integrateStarted",
  "removeStarted",
  "stepFailed",
];

const EXPECTED_ALLOWED: Readonly<Record<string, ReadonlyArray<string>>> = {
  idle: ["statusRequested", ...NON_BUSY_ACCEPTED],
  idleLoading: ["statusFailed", "reset", ...NON_BUSY_ACCEPTED],
  committing: ["commitSucceeded", "stepFailed"],
  committed: ["reset", ...NON_BUSY_ACCEPTED],
  pushing: ["pushSucceeded", "stepFailed"],
  pushed: ["reset", ...NON_BUSY_ACCEPTED],
  integrating: ["integrateSucceeded", "stepFailed"],
  integrated: ["reset", ...NON_BUSY_ACCEPTED],
  removingWorktree: ["removeSucceeded", "stepFailed"],
  worktreeRemoved: [],
  failed: ["reset", ...NON_BUSY_ACCEPTED],
};

describe("agentShipReducer transition matrix", () => {
  it("agrees with agentShipTransitionAllowed for every state and action", () => {
    for (const { name: stateName, state } of STATES) {
      for (const { name: actionName, action } of ACTIONS) {
        const next = agentShipReducer(state, action);
        const allowed = agentShipTransitionAllowed(state, action);

        expect(
          { state: stateName, action: actionName, allowed },
          `${stateName} + ${actionName}`,
        ).toEqual({ state: stateName, action: actionName, allowed: next !== state });
      }
    }
  });

  it("allows exactly the documented actions per state", () => {
    for (const { name: stateName, state } of STATES) {
      const allowed = ACTIONS.filter(({ action }) => agentShipTransitionAllowed(state, action)).map(
        ({ name }) => name,
      );

      expect(allowed.slice().sort(), stateName).toEqual(EXPECTED_ALLOWED[stateName].slice().sort());
    }
  });

  it("returns the same state reference for every refused action", () => {
    for (const { name: stateName, state } of STATES) {
      for (const { name: actionName, action } of ACTIONS) {
        if (agentShipTransitionAllowed(state, action)) continue;
        expect(agentShipReducer(state, action), `${stateName} + ${actionName}`).toBe(state);
      }
    }
  });

  it("keeps every busy state busy and every settled state idle-capable", () => {
    const busy = STATES.filter(({ state }) => isAgentShipBusy(state)).map(({ name }) => name);

    expect(busy).toEqual(["committing", "pushing", "integrating", "removingWorktree"]);
  });
});

describe("status transitions", () => {
  it("marks idle as loading and keeps the previous status", () => {
    const state = agentShipReducer(
      { kind: "idle", status: STATUS, loadingStatus: false },
      { kind: "statusRequested" },
    );

    expect(state).toEqual({ kind: "idle", status: STATUS, loadingStatus: true });
  });

  it("clears the loading flag when a status request fails without losing the last status", () => {
    const state = agentShipReducer(
      { kind: "idle", status: STATUS, loadingStatus: true },
      { kind: "statusFailed", message: "git failed" },
    );

    expect(state).toEqual({ kind: "idle", status: STATUS, loadingStatus: false });
  });

  it("replaces the status without dropping the payload of a settled state", () => {
    const committed = agentShipReducer(
      { kind: "committed", status: STATUS, commitSha: COMMIT_SHA },
      { kind: "statusLoaded", status: FRESH_STATUS },
    );
    const pushed = agentShipReducer(
      { kind: "pushed", status: null, receipt: RECEIPT },
      { kind: "statusLoaded", status: FRESH_STATUS },
    );
    const integrated = agentShipReducer(
      { kind: "integrated", status: null, mergeSha: MERGE_SHA, intoBranch: "main" },
      { kind: "statusLoaded", status: FRESH_STATUS },
    );

    expect(committed).toEqual({
      kind: "committed",
      status: FRESH_STATUS,
      commitSha: COMMIT_SHA,
    });
    expect(pushed).toEqual({ kind: "pushed", status: FRESH_STATUS, receipt: RECEIPT });
    expect(integrated).toEqual({
      kind: "integrated",
      status: FRESH_STATUS,
      mergeSha: MERGE_SHA,
      intoBranch: "main",
    });
  });
});

describe("step transitions", () => {
  it("runs the happy path from idle to a removed worktree", () => {
    const start: AgentShipState = { kind: "idle", status: STATUS, loadingStatus: false };
    const committing = agentShipReducer(start, { kind: "commitStarted", message: "Work" });
    const committed = agentShipReducer(committing, {
      kind: "commitSucceeded",
      commitSha: NEXT_SHA,
      status: FRESH_STATUS,
    });
    const pushing = agentShipReducer(committed, { kind: "pushStarted" });
    const pushed = agentShipReducer(pushing, {
      kind: "pushSucceeded",
      receipt: RECEIPT,
      status: FRESH_STATUS,
    });
    const integrating = agentShipReducer(pushed, {
      kind: "integrateStarted",
      mode: "fastForward",
    });
    const integrated = agentShipReducer(integrating, {
      kind: "integrateSucceeded",
      mergeSha: MERGE_SHA,
      intoBranch: "main",
      status: FRESH_STATUS,
    });
    const removing = agentShipReducer(integrated, {
      kind: "removeStarted",
      deleteBranch: true,
    });
    const removed = agentShipReducer(removing, {
      kind: "removeSucceeded",
      branchDeleted: true,
    });

    expect(committing).toEqual({
      kind: "committing",
      status: STATUS,
      message: "Work",
      resumeFrom: "idle",
    });
    expect(pushing).toEqual({
      kind: "pushing",
      status: FRESH_STATUS,
      commitSha: NEXT_SHA,
      resumeFrom: "committed",
    });
    expect(integrating).toEqual({
      kind: "integrating",
      status: FRESH_STATUS,
      mode: "fastForward",
      resumeFrom: "pushed",
    });
    expect(removing).toEqual({
      kind: "removingWorktree",
      status: FRESH_STATUS,
      deleteBranch: true,
      resumeFrom: "integrated",
    });
    expect(removed).toEqual({ kind: "worktreeRemoved", branchDeleted: true });
    expect(agentShipStatus(removed)).toBeNull();
  });

  it("records the exact predecessor of a failed step so retry is not overstated", () => {
    const pushed: AgentShipState = { kind: "pushed", status: STATUS, receipt: RECEIPT };
    const removing = agentShipReducer(pushed, { kind: "removeStarted", deleteBranch: false });
    const failed = agentShipReducer(removing, {
      kind: "stepFailed",
      failure: { step: "removeWorktree", reason: "dirty", message: "dirty worktree" },
    });

    expect(failed).toEqual({
      kind: "failed",
      status: STATUS,
      failure: { step: "removeWorktree", reason: "dirty", message: "dirty worktree" },
      resumeFrom: "pushed",
    });
  });

  it("carries the resume point through a retry and through a second failure", () => {
    const failed: AgentShipState = {
      kind: "failed",
      status: STATUS,
      failure: { step: "push", reason: "rejected", message: "rejected" },
      resumeFrom: "committed",
    };
    const retry = agentShipReducer(failed, { kind: "pushStarted" });
    const failedAgain = agentShipReducer(retry, {
      kind: "stepFailed",
      failure: { step: "push", reason: "authRequired", message: "no credentials" },
    });

    expect(retry).toEqual({
      kind: "pushing",
      status: STATUS,
      commitSha: null,
      resumeFrom: "committed",
    });
    expect(failedAgain).toEqual({
      kind: "failed",
      status: STATUS,
      failure: { step: "push", reason: "authRequired", message: "no credentials" },
      resumeFrom: "committed",
    });
  });

  it("resets a failure back to idle while keeping the last known status", () => {
    const failed: AgentShipState = {
      kind: "failed",
      status: STATUS,
      failure: { step: "commit", reason: "nothingToCommit", message: "nothing" },
      resumeFrom: "idle",
    };

    expect(agentShipReducer(failed, { kind: "reset" })).toEqual({
      kind: "idle",
      status: STATUS,
      loadingStatus: false,
    });
  });

  it("treats a removed worktree as terminal", () => {
    const removed: AgentShipState = { kind: "worktreeRemoved", branchDeleted: true };

    for (const { action } of ACTIONS) {
      expect(agentShipReducer(removed, action)).toBe(removed);
    }
  });
});

describe("bounded payloads", () => {
  it("truncates an oversize commit message on a UTF-8 boundary", () => {
    const message = "é".repeat(MAX_AGENT_SHIP_COMMIT_MESSAGE_BYTES);
    const state = agentShipReducer(
      { kind: "idle", status: STATUS, loadingStatus: false },
      { kind: "commitStarted", message },
    );

    expect(state.kind).toBe("committing");
    const stored = state.kind === "committing" ? state.message : "";
    expect(utf8ByteLength(stored)).toBeLessThanOrEqual(MAX_AGENT_SHIP_COMMIT_MESSAGE_BYTES);
    expect(stored).toBe("é".repeat(MAX_AGENT_SHIP_COMMIT_MESSAGE_BYTES / 2));
    expect(stored).not.toContain("�");
  });

  it("strips NUL bytes from a commit message", () => {
    const state = agentShipReducer(
      { kind: "idle", status: STATUS, loadingStatus: false },
      { kind: "commitStarted", message: "fix\u0000 parser" },
    );

    expect(state.kind === "committing" ? state.message : "").toBe("fix parser");
  });

  it("truncates an oversize failure message", () => {
    const state = agentShipReducer(
      { kind: "idle", status: STATUS, loadingStatus: false },
      {
        kind: "stepFailed",
        failure: { step: "commit", reason: "gitError", message: "ü".repeat(2_000) },
      },
    );

    expect(state.kind).toBe("failed");
    const failure = state.kind === "failed" ? state.failure : null;
    const message = failure !== null && "message" in failure ? failure.message : "";
    expect(utf8ByteLength(message)).toBeLessThanOrEqual(MAX_AGENT_SHIP_FAILURE_BYTES);
    expect(message).not.toContain("�");
  });

  it("caps a conflicted integration file list and reports the truncation", () => {
    const files = Array.from(
      { length: MAX_GIT_INTEGRATION_CONFLICT_FILES + 5 },
      (_unused, index) => `src/file-${index}.ts`,
    );
    const state = agentShipReducer(
      { kind: "idle", status: STATUS, loadingStatus: false },
      {
        kind: "stepFailed",
        failure: { step: "integrate", outcome: { kind: "conflicted", files, truncated: false } },
      },
    );

    expect(state).toEqual({
      kind: "failed",
      status: STATUS,
      failure: {
        step: "integrate",
        outcome: {
          kind: "conflicted",
          files: files.slice(0, MAX_GIT_INTEGRATION_CONFLICT_FILES),
          truncated: true,
        },
      },
      resumeFrom: "idle",
    });
  });

  it("truncates an abort failure message and keeps outcomes without payloads intact", () => {
    const state = agentShipReducer(
      { kind: "idle", status: STATUS, loadingStatus: false },
      {
        kind: "stepFailed",
        failure: {
          step: "integrate",
          outcome: { kind: "abortFailed", message: "x".repeat(4_000) },
        },
      },
    );
    const stale = agentShipReducer(
      { kind: "idle", status: STATUS, loadingStatus: false },
      { kind: "stepFailed", failure: { step: "integrate", outcome: { kind: "staleExpectation" } } },
    );

    const failure = state.kind === "failed" ? state.failure : null;
    const message =
      failure !== null && "outcome" in failure && failure.outcome.kind === "abortFailed"
        ? failure.outcome.message
        : "";
    expect(message).toBe("x".repeat(MAX_AGENT_SHIP_FAILURE_BYTES));
    expect(stale.kind === "failed" ? stale.failure : null).toEqual({
      step: "integrate",
      outcome: { kind: "staleExpectation" },
    });
  });

  it("keeps a thrown integrate git error distinct from an integration outcome", () => {
    const state = agentShipReducer(
      { kind: "integrating", status: STATUS, mode: "merge", resumeFrom: "committed" },
      {
        kind: "stepFailed",
        failure: { step: "integrate", reason: "gitError", message: "ü".repeat(2_000) },
      },
    );

    expect(state.kind).toBe("failed");
    const failure = state.kind === "failed" ? state.failure : null;
    expect(failure).not.toBeNull();
    expect(failure !== null && "outcome" in failure).toBe(false);
    const message = failure !== null && "message" in failure ? failure.message : "";
    expect(utf8ByteLength(message)).toBeLessThanOrEqual(MAX_AGENT_SHIP_FAILURE_BYTES);
    expect(message).not.toContain("�");
    expect(state.kind === "failed" ? state.resumeFrom : null).toBe("committed");
  });
});

describe("initialAgentShipState", () => {
  it("returns idle without a receipt", () => {
    expect(initialAgentShipState(null)).toEqual({
      kind: "idle",
      status: null,
      loadingStatus: false,
    });
  });

  it("returns idle for a receipt that records nothing", () => {
    expect(
      initialAgentShipState({
        lastCommitSha: null,
        pushed: null,
        integrated: null,
        branchDeleted: false,
      }),
    ).toEqual({ kind: "idle", status: null, loadingStatus: false });
  });

  it("prefers the most advanced receipt step", () => {
    const committed = initialAgentShipState({
      lastCommitSha: COMMIT_SHA,
      pushed: null,
      integrated: null,
      branchDeleted: false,
    });
    const pushed = initialAgentShipState({
      lastCommitSha: COMMIT_SHA,
      pushed: { remote: "origin", branch: "agent/agt-0001" },
      integrated: null,
      branchDeleted: false,
    });
    const integrated = initialAgentShipState({
      lastCommitSha: COMMIT_SHA,
      pushed: { remote: "origin", branch: "agent/agt-0001" },
      integrated: { intoBranch: "main", mergeSha: MERGE_SHA, mode: "merge" },
      branchDeleted: true,
    });

    expect(committed).toEqual({ kind: "committed", status: null, commitSha: COMMIT_SHA });
    expect(pushed).toEqual({ kind: "pushed", status: null, receipt: RECEIPT });
    expect(integrated).toEqual({
      kind: "integrated",
      status: null,
      mergeSha: MERGE_SHA,
      intoBranch: "main",
    });
  });

  it("never restores a compare URL from a receipt", () => {
    const pushed = initialAgentShipState({
      lastCommitSha: null,
      pushed: { remote: "origin", branch: "agent/agt-0001" },
      integrated: null,
      branchDeleted: false,
    });

    expect(pushed.kind === "pushed" ? pushed.receipt.compareUrl : "unset").toBeNull();
  });
});
