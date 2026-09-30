import { describe, expect, it } from "vitest";
import { MAX_PERSISTED_AGENT_PROJECT_SELECTIONS } from "../../domain/agentProjectSelectionSnapshot";
import { createAgentNavigationRestoreLedger } from "./agentNavigationRestoreLedger";

const APP = { projectRootKey: "/work/app", threadId: "agt-1", repositoryRoot: "/work/app" };
const API = { projectRootKey: "/work/api", threadId: "agt-9", repositoryRoot: "/work/api" };

function ledgerWith(entries = [APP, API]) {
  let changes = 0;
  const ledger = createAgentNavigationRestoreLedger(entries, () => (changes += 1));
  return { ledger, changes: () => changes };
}

describe("agent navigation restore ledger", () => {
  it("recalls the last launch's thread until the project is settled in this launch", () => {
    const { ledger } = ledgerWith();

    expect(ledger.recall(APP.projectRootKey)).toEqual(APP);
    ledger.settle(APP.projectRootKey);

    expect(ledger.recall(APP.projectRootKey)).toBeNull();
    expect(ledger.recall(API.projectRootKey)).toEqual(API);
  });

  it("ignores an automatic empty selection for a project this launch has not decided", () => {
    const { ledger, changes } = ledgerWith();

    ledger.remember({ projectRootKey: APP.projectRootKey, threadId: null, repositoryRoot: null });

    expect(changes()).toBe(0);
    expect(ledger.snapshot()).toContainEqual(APP);
  });

  it("records an empty selection once the user decided it for the project", () => {
    const { ledger, changes } = ledgerWith();
    ledger.settle(APP.projectRootKey);

    ledger.remember({ projectRootKey: APP.projectRootKey, threadId: null, repositoryRoot: null });

    expect(changes()).toBe(1);
    expect(ledger.snapshot()).toContainEqual({
      projectRootKey: APP.projectRootKey,
      threadId: null,
      repositoryRoot: null,
    });
  });

  it("stops recalling a declined project but keeps its thread for the next launch", () => {
    const { ledger } = ledgerWith();

    ledger.decline(APP.projectRootKey);
    ledger.remember({ projectRootKey: APP.projectRootKey, threadId: null, repositoryRoot: null });

    expect(ledger.recall(APP.projectRootKey)).toBeNull();
    expect(ledger.snapshot()).toContainEqual(APP);
  });

  it("does not report a change when the newest selection is remembered again", () => {
    const { ledger, changes } = ledgerWith();

    ledger.remember(API);
    ledger.remember(APP);
    ledger.remember(APP);

    expect(changes()).toBe(1);
  });

  it("ignores remote projects and forgets deleted threads", () => {
    const { ledger, changes } = ledgerWith();

    ledger.remember({ projectRootKey: "remote:s:p", threadId: "agt-r", repositoryRoot: "/r" });
    ledger.forgetThread("agt-1");
    ledger.forgetThread("agt-unknown");

    expect(changes()).toBe(1);
    expect(ledger.snapshot()).toEqual([API]);
  });

  it("keeps only the most recent projects", () => {
    const { ledger } = ledgerWith([]);
    for (let index = 0; index <= MAX_PERSISTED_AGENT_PROJECT_SELECTIONS; index += 1) {
      ledger.remember({ projectRootKey: `/p${index}`, threadId: "agt", repositoryRoot: "/r" });
    }

    const snapshot = ledger.snapshot();
    expect(snapshot).toHaveLength(MAX_PERSISTED_AGENT_PROJECT_SELECTIONS);
    expect(snapshot[0]?.projectRootKey).toBe("/p1");
  });
});
