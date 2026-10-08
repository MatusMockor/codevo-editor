import { describe, expect, it } from "vitest";
import type { AgentComposerAttachmentDraft } from "../../application/useAgentComposerAttachments";
import {
  MAX_AGENT_PENDING_SENDS,
  agentPendingSendAttachments,
  agentPendingSendFor,
  agentPendingSendProvider,
  reduceAgentPendingSends,
  type AgentPendingSend,
  type AgentPendingSends,
} from "./agentPendingSend";

function send(id: number, target: AgentPendingSend["target"]): AgentPendingSend {
  return {
    id,
    target,
    prompt: `prompt ${id}`,
    attachments: [],
    sentAtEpochMs: id,
    status: "sending",
  };
}

const followUp = (threadId: string, baseTurnId: string | null = "t1") =>
  ({ kind: "followUp", threadId, baseTurnId }) as const;

function draft(patch: Partial<AgentComposerAttachmentDraft>): AgentComposerAttachmentDraft {
  return {
    draftId: "d1",
    kind: "image",
    entry: "file",
    state: "ready",
    name: "shot.png",
    bytes: 10,
    mime: "image/png",
    width: 40,
    height: 20,
    attachmentId: "0123456789abcdef0123456789abcdef",
    path: null,
    previewUrl: "blob:preview-1",
    failure: null,
    notice: null,
    missing: false,
    promptLineBytesMax: 0,
    ...patch,
  };
}

describe("agent pending sends", () => {
  it("shows a follow-up only on its thread until the real turn is registered", () => {
    const state = reduceAgentPendingSends([], { kind: "begin", send: send(1, followUp("a")) });
    expect(
      agentPendingSendFor(state, { kind: "thread", threadId: "a", lastTurnId: "t1" })?.id,
    ).toBe(1);
    expect(
      agentPendingSendFor(state, { kind: "thread", threadId: "a", lastTurnId: "t2" }),
    ).toBeNull();
    expect(
      agentPendingSendFor(state, { kind: "thread", threadId: "b", lastTurnId: "t1" }),
    ).toBeNull();
    expect(agentPendingSendFor(state, { kind: "new", projectRootKey: "/app" })).toBeNull();
  });

  it("shows a new-thread send only on the empty composer of the same project", () => {
    const state = reduceAgentPendingSends([], {
      kind: "begin",
      send: send(1, { kind: "new", projectRootKey: "/app", provider: "claudeCode" }),
    });
    expect(agentPendingSendFor(state, { kind: "new", projectRootKey: "/app" })?.id).toBe(1);
    expect(agentPendingSendFor(state, { kind: "new", projectRootKey: "/other" })).toBeNull();
    expect(agentPendingSendFor(state, null)).toBeNull();
  });

  it("removes a delivered send, keeps a failed one truthful until dismissed or replaced", () => {
    let state: AgentPendingSends = reduceAgentPendingSends([], {
      kind: "begin",
      send: send(1, followUp("a")),
    });
    state = reduceAgentPendingSends(state, { kind: "settle", id: 1, outcome: "failed" });
    expect(state).toEqual([{ ...send(1, followUp("a")), status: "failed" }]);
    state = reduceAgentPendingSends(state, { kind: "begin", send: send(2, followUp("a")) });
    expect(state.map((entry) => entry.id)).toEqual([2]);
    state = reduceAgentPendingSends(state, { kind: "begin", send: send(5, followUp("a")) });
    expect(state.map((entry) => entry.id)).toEqual([2, 5]);
    state = reduceAgentPendingSends(state, { kind: "settle", id: 5, outcome: "sent" });
    state = reduceAgentPendingSends(state, { kind: "settle", id: 2, outcome: "sent" });
    expect(state).toEqual([]);
    state = reduceAgentPendingSends([send(3, followUp("b"))], {
      kind: "settle",
      id: 3,
      outcome: "withdrawn",
    });
    expect(state).toEqual([]);
    state = reduceAgentPendingSends([{ ...send(4, followUp("c")), status: "failed" }], {
      kind: "dismiss",
      id: 4,
    });
    expect(state).toEqual([]);
  });

  it("ignores stale settlements and bounds retained sends", () => {
    const state = reduceAgentPendingSends([send(1, followUp("a"))], {
      kind: "settle",
      id: 9,
      outcome: "failed",
    });
    expect(state).toEqual([send(1, followUp("a"))]);
    let many: AgentPendingSends = [];
    for (let id = 1; id <= MAX_AGENT_PENDING_SENDS + 3; id += 1) {
      many = reduceAgentPendingSends(many, { kind: "begin", send: send(id, followUp(`t${id}`)) });
    }
    expect(many).toHaveLength(MAX_AGENT_PENDING_SENDS);
    expect(many[0]?.id).toBe(4);
  });

  it("renders a held folder as a folder pill and a held file reference as a link chip", () => {
    const held = { kind: "reference", mime: null, previewUrl: null } as const;
    expect(
      agentPendingSendAttachments([
        draft({
          ...held,
          draftId: "d5",
          entry: "directory",
          name: "invoices",
          path: "/Users/x/Documents/codevo s.r.o./invoices",
        }),
        draft({ ...held, draftId: "d6", name: "clip.mp4", path: "/Users/dev/clip.mp4" }),
      ]),
    ).toEqual([
      {
        view: {
          kind: "folder",
          key: "d5",
          name: "invoices",
          path: "/Users/x/Documents/codevo s.r.o./invoices",
        },
        previewUrl: null,
      },
      {
        view: { kind: "chip", key: "d6", name: "clip.mp4", glyph: "reference" },
        previewUrl: null,
      },
    ]);
  });

  it("renders held image previews as thumbnails and everything else as chips", () => {
    expect(
      agentPendingSendAttachments([
        draft({}),
        draft({ draftId: "d2", previewUrl: null, name: "raw.png" }),
        draft({ draftId: "d3", kind: "file", mime: null, previewUrl: null, name: "log.txt" }),
        draft({ draftId: "d4", kind: "reference", mime: null, previewUrl: null, name: "big.mov" }),
      ]),
    ).toEqual([
      {
        view: {
          kind: "image",
          key: "d1",
          name: "shot.png",
          attachmentId: "0123456789abcdef0123456789abcdef",
          mime: "image/png",
          width: 40,
          height: 20,
        },
        previewUrl: "blob:preview-1",
      },
      { view: { kind: "chip", key: "d2", name: "raw.png", glyph: "image" }, previewUrl: null },
      { view: { kind: "chip", key: "d3", name: "log.txt", glyph: "file" }, previewUrl: null },
      { view: { kind: "chip", key: "d4", name: "big.mov", glyph: "reference" }, previewUrl: null },
    ]);
  });
});

describe("agentPendingSendProvider", () => {
  it("reads the provider a new thread was launched with", () => {
    expect(
      agentPendingSendProvider(send(1, { kind: "new", projectRootKey: "/app", provider: "codex" })),
    ).toBe("codex");
  });

  it("leaves a follow-up's provider to its thread", () => {
    expect(agentPendingSendProvider(send(1, followUp("agt-1")))).toBeNull();
  });
});
