import { describe, expect, it } from "vitest";
import {
  advanceAgentComposerDraftLineage,
  agentComposerDraftIdentityEqual,
  agentComposerDraftIdentityKey,
  carriedAgentComposerDraftText,
  NO_AGENT_COMPOSER_DRAFT,
  openAgentComposerDraftLineage,
  type AgentComposerDraftIdentity,
  type AgentComposerDraftLineage,
} from "./agentComposerDraftLineage";

const LOCAL_A: AgentComposerDraftIdentity = { kind: "new", key: "new:/a", machine: null };
const LOCAL_B: AgentComposerDraftIdentity = { kind: "new", key: "new:/b", machine: null };
const SERVER_A: AgentComposerDraftIdentity = { kind: "new", key: "new:remote:s:r:a", machine: "s" };
const SERVER_B: AgentComposerDraftIdentity = { kind: "new", key: "new:remote:s:r:b", machine: "s" };
const OTHER_SERVER: AgentComposerDraftIdentity = {
  kind: "new",
  key: "new:remote:t:r:a",
  machine: "t",
};
const THREAD_A: AgentComposerDraftIdentity = { kind: "thread", key: "thread-a" };
const THREAD_B: AgentComposerDraftIdentity = { kind: "thread", key: "thread-b" };

function at(identity: AgentComposerDraftIdentity): AgentComposerDraftLineage {
  return openAgentComposerDraftLineage(identity);
}

function unresolved(requested: string | null): AgentComposerDraftIdentity {
  return { kind: "none", requested };
}

describe("advanceAgentComposerDraftLineage", () => {
  it("carries a new-thread draft when only the execution machine changes", () => {
    expect(advanceAgentComposerDraftLineage(at(LOCAL_A), SERVER_A, "environment")).toEqual({
      presented: SERVER_A,
      hold: "released",
      awaiting: null,
      carriedFrom: "new:/a",
    });
    expect(advanceAgentComposerDraftLineage(at(SERVER_A), LOCAL_A, "environment")).toEqual({
      presented: LOCAL_A,
      hold: "released",
      awaiting: null,
      carriedFrom: "new:remote:s:r:a",
    });
    expect(
      advanceAgentComposerDraftLineage(at(SERVER_A), OTHER_SERVER, "environment").carriedFrom,
    ).toBe("new:remote:s:r:a");
  });

  it("keeps per-project drafts when the project changes on the same machine", () => {
    expect(advanceAgentComposerDraftLineage(at(LOCAL_A), LOCAL_B, "environment")).toEqual(
      at(LOCAL_B),
    );
    expect(advanceAgentComposerDraftLineage(at(SERVER_A), SERVER_B, "environment")).toEqual(
      at(SERVER_B),
    );
  });

  it("opens the destination's own draft when the user navigated to another machine's project", () => {
    expect(advanceAgentComposerDraftLineage(at(LOCAL_A), SERVER_B, "navigation")).toEqual(
      at(SERVER_B),
    );
  });

  it("holds the draft while the new machine has no target and carries it to the chosen one", () => {
    const held = advanceAgentComposerDraftLineage(
      at(LOCAL_A),
      NO_AGENT_COMPOSER_DRAFT,
      "environment",
    );
    expect(held).toEqual({
      presented: LOCAL_A,
      hold: "carriable",
      awaiting: null,
      carriedFrom: null,
    });
    expect(advanceAgentComposerDraftLineage(held, SERVER_B, "navigation")).toEqual({
      presented: SERVER_B,
      hold: "released",
      awaiting: null,
      carriedFrom: "new:/a",
    });
  });

  it("keeps a held draft carriable when navigation still asks for the same project", () => {
    const held = advanceAgentComposerDraftLineage(at(LOCAL_A), unresolved("/a"), "environment");
    expect(held.awaiting).toBe("/a");
    expect(advanceAgentComposerDraftLineage(held, unresolved("/a"), "navigation")).toBe(held);
    expect(advanceAgentComposerDraftLineage(held, SERVER_B, "navigation").carriedFrom).toBe(
      "new:/a",
    );
  });

  it("anchors a held draft once the user navigates to another project that has no target", () => {
    const held = advanceAgentComposerDraftLineage(at(LOCAL_A), unresolved("/a"), "environment");
    const anchored = advanceAgentComposerDraftLineage(held, unresolved("/b"), "navigation");
    expect(anchored).toEqual({
      presented: LOCAL_A,
      hold: "anchored",
      awaiting: "/b",
      carriedFrom: null,
    });
    expect(advanceAgentComposerDraftLineage(anchored, OTHER_SERVER, "environment")).toEqual(
      at(OTHER_SERVER),
    );
    expect(advanceAgentComposerDraftLineage(anchored, unresolved("/a"), "navigation").hold).toBe(
      "anchored",
    );
    expect(advanceAgentComposerDraftLineage(anchored, LOCAL_A, "navigation")).toEqual(at(LOCAL_A));
  });

  it("follows a requested project that changes without navigation and stays carriable", () => {
    const held = advanceAgentComposerDraftLineage(at(LOCAL_A), unresolved("/a"), "environment");
    const moved = advanceAgentComposerDraftLineage(held, unresolved("/c"), "environment");
    expect(moved).toEqual({ ...held, awaiting: "/c" });
    expect(advanceAgentComposerDraftLineage(moved, unresolved("/c"), "navigation")).toBe(moved);
    expect(advanceAgentComposerDraftLineage(moved, SERVER_A, "environment").carriedFrom).toBe(
      "new:/a",
    );
  });

  it("resumes a held draft on its own target without moving it", () => {
    const held = advanceAgentComposerDraftLineage(
      at(LOCAL_A),
      NO_AGENT_COMPOSER_DRAFT,
      "environment",
    );
    expect(advanceAgentComposerDraftLineage(held, LOCAL_A, "environment")).toEqual(at(LOCAL_A));
  });

  it("leaves a held draft with its project when the user lands on the same machine", () => {
    const held = advanceAgentComposerDraftLineage(
      at(LOCAL_A),
      NO_AGENT_COMPOSER_DRAFT,
      "environment",
    );
    expect(advanceAgentComposerDraftLineage(held, LOCAL_B, "navigation")).toEqual(at(LOCAL_B));
  });

  it("never carries a draft whose target was lost through navigation", () => {
    const anchored = advanceAgentComposerDraftLineage(
      at(LOCAL_A),
      NO_AGENT_COMPOSER_DRAFT,
      "navigation",
    );
    expect(anchored.hold).toBe("anchored");
    expect(advanceAgentComposerDraftLineage(anchored, SERVER_A, "environment")).toEqual(
      at(SERVER_A),
    );
  });

  it("keeps thread drafts isolated from every other draft", () => {
    expect(advanceAgentComposerDraftLineage(at(THREAD_A), THREAD_B, "environment")).toEqual(
      at(THREAD_B),
    );
    expect(advanceAgentComposerDraftLineage(at(THREAD_A), SERVER_A, "environment")).toEqual(
      at(SERVER_A),
    );
    expect(advanceAgentComposerDraftLineage(at(LOCAL_A), THREAD_A, "environment")).toEqual(
      at(THREAD_A),
    );
    expect(
      advanceAgentComposerDraftLineage(at(THREAD_A), NO_AGENT_COMPOSER_DRAFT, "environment"),
    ).toEqual(at(NO_AGENT_COMPOSER_DRAFT));
    const held = advanceAgentComposerDraftLineage(
      at(LOCAL_A),
      NO_AGENT_COMPOSER_DRAFT,
      "environment",
    );
    expect(advanceAgentComposerDraftLineage(held, THREAD_A, "environment")).toEqual(at(THREAD_A));
  });

  it("lets text typed without a target be adopted by the first target", () => {
    expect(
      advanceAgentComposerDraftLineage(at(NO_AGENT_COMPOSER_DRAFT), SERVER_A, "environment"),
    ).toEqual(at(SERVER_A));
  });

  it("returns the same lineage when nothing changed", () => {
    const local = at(LOCAL_A);
    expect(advanceAgentComposerDraftLineage(local, { ...LOCAL_A }, "navigation")).toBe(local);
    const thread = at(THREAD_A);
    expect(advanceAgentComposerDraftLineage(thread, { ...THREAD_A }, "environment")).toBe(thread);
    const none = at(NO_AGENT_COMPOSER_DRAFT);
    expect(advanceAgentComposerDraftLineage(none, unresolved(null), "navigation")).toBe(none);
    expect(advanceAgentComposerDraftLineage(none, unresolved("/a"), "navigation")).toEqual(
      at(unresolved("/a")),
    );
  });

  it("forgets where a draft came from once it moves on", () => {
    const carried = advanceAgentComposerDraftLineage(at(LOCAL_A), SERVER_A, "environment");
    expect(advanceAgentComposerDraftLineage(carried, SERVER_B, "navigation")).toEqual(at(SERVER_B));
    expect(advanceAgentComposerDraftLineage(carried, LOCAL_A, "environment").carriedFrom).toBe(
      "new:remote:s:r:a",
    );
  });
});

describe("agentComposerDraftIdentity helpers", () => {
  it("compares identities by kind, key and machine", () => {
    expect(agentComposerDraftIdentityEqual(LOCAL_A, { ...LOCAL_A })).toBe(true);
    expect(agentComposerDraftIdentityEqual(LOCAL_A, LOCAL_B)).toBe(false);
    expect(
      agentComposerDraftIdentityEqual(THREAD_A, { kind: "new", key: "thread-a", machine: null }),
    ).toBe(false);
    expect(agentComposerDraftIdentityEqual(NO_AGENT_COMPOSER_DRAFT, unresolved(null))).toBe(true);
    expect(agentComposerDraftIdentityEqual(unresolved("/a"), unresolved("/b"))).toBe(false);
    expect(agentComposerDraftIdentityEqual(NO_AGENT_COMPOSER_DRAFT, LOCAL_A)).toBe(false);
  });

  it("exposes the draft key of an identity", () => {
    expect(agentComposerDraftIdentityKey(NO_AGENT_COMPOSER_DRAFT)).toBeNull();
    expect(agentComposerDraftIdentityKey(THREAD_A)).toBe("thread-a");
    expect(agentComposerDraftIdentityKey(SERVER_A)).toBe("new:remote:s:r:a");
  });
});

describe("carriedAgentComposerDraftText", () => {
  it("shows the carried text when the destination holds nothing", () => {
    expect(carriedAgentComposerDraftText("Fix login", "")).toBe("Fix login");
  });

  it("shows the destination's stored draft when nothing was carried", () => {
    expect(carriedAgentComposerDraftText("", "Stored")).toBe("Stored");
    expect(carriedAgentComposerDraftText("  \n", "Stored")).toBe("Stored");
  });

  it("keeps both drafts, carried text first, when both hold text", () => {
    expect(carriedAgentComposerDraftText("Fix login  \n", "Stored")).toBe("Fix login\n\nStored");
  });

  it("does not duplicate an identical draft", () => {
    expect(carriedAgentComposerDraftText("Fix login", "Fix login")).toBe("Fix login");
  });
});
