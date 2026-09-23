// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeferredFollowUp, DeferredFollowUps } from "../../application/agentDeferredFollowUps";
import type { AgentQueuedEditSession } from "../../application/agentQueuedFollowUpEdit";
import {
  useAgentQueuedFollowUpEdit,
  type AgentQueuedFollowUpEditPort,
  type AgentQueuedFollowUpEditState,
} from "./useAgentQueuedFollowUpEdit";

const SESSION: AgentQueuedEditSession = {
  threadId: "agt-1",
  entryId: "deferred-1",
  lease: 3,
  prompt: "and then ship it",
  attachments: [
    {
      key: "attachment-0",
      attachment: { kind: "reference", name: "notes.md", path: "/work/notes.md", bytes: 12 },
    },
  ],
};

function queued(editLease?: number): DeferredFollowUps {
  const entry: DeferredFollowUp = {
    id: "deferred-1",
    request: {
      threadId: "agt-1",
      prompt: "and then ship it",
      launch: { provider: "claudeCode", model: "default", mode: "default", effort: "default" },
    },
    queuedAtEpochMs: 1,
    ...(editLease === undefined ? {} : { editLease }),
  };
  return new Map([["agt-1", [entry]]]);
}

describe("useAgentQueuedFollowUpEdit", () => {
  let host: HTMLDivElement;
  let root: Root;
  let state: AgentQueuedFollowUpEditState | null;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    root = createRoot(host);
    state = null;
  });

  afterEach(() => {
    act(() => root.unmount());
  });

  function Harness({
    port,
    selectedThreadId,
  }: {
    readonly port: AgentQueuedFollowUpEditPort;
    readonly selectedThreadId: string | null;
  }) {
    state = useAgentQueuedFollowUpEdit(port, selectedThreadId);
    return null;
  }

  function render(port: AgentQueuedFollowUpEditPort, selectedThreadId: string | null = "agt-1") {
    act(() => root.render(<Harness port={port} selectedThreadId={selectedThreadId} />));
  }

  function current(): AgentQueuedFollowUpEditState {
    expect(state).not.toBeNull();
    return state as AgentQueuedFollowUpEditState;
  }

  function port(
    deferredFollowUps: DeferredFollowUps,
    overrides: Partial<AgentQueuedFollowUpEditPort> = {},
  ): AgentQueuedFollowUpEditPort {
    return {
      deferredFollowUps,
      beginDeferredFollowUpEdit: vi.fn(() => SESSION),
      cancelDeferredFollowUpEdit: vi.fn(),
      commitDeferredFollowUpEdit: vi.fn(async () => true),
      ...overrides,
    };
  }

  it("exposes the leased entry as a composer edit and forgets it once the lease is gone", () => {
    const edits = port(queued());
    render(edits);
    act(() => current().begin("agt-1", "deferred-1"));
    render({ ...edits, deferredFollowUps: queued(SESSION.lease) });

    expect(current().edit?.prompt).toBe("and then ship it");
    expect(current().edit?.attachments.map((draft) => draft.name)).toEqual(["notes.md"]);

    render({ ...edits, deferredFollowUps: queued() });
    expect(current().edit).toBeNull();
    render({ ...edits, deferredFollowUps: queued(SESSION.lease) });
    expect(current().edit).toBeNull();
  });

  it("commits only the attachments still kept and ends the edit on success", async () => {
    const commitDeferredFollowUpEdit = vi.fn(async () => true);
    const edits = port(queued(), { commitDeferredFollowUpEdit });
    render(edits);
    act(() => current().begin("agt-1", "deferred-1"));
    render({ ...edits, deferredFollowUps: queued(SESSION.lease) });

    act(() => current().edit?.onRemoveAttachment("queued-edit:attachment-0"));
    expect(current().edit?.attachments).toEqual([]);
    let committed = false;
    await act(async () => {
      committed = (await current().edit?.commit("closer", {})) === true;
    });

    expect(committed).toBe(true);
    expect(commitDeferredFollowUpEdit).toHaveBeenCalledExactlyOnceWith(SESSION, {
      prompt: "closer",
      keptAttachmentKeys: [],
    });
    expect(current().edit).toBeNull();
  });

  it("releases the lease when the view unmounts mid-edit and when a new edit replaces it", () => {
    const cancelDeferredFollowUpEdit = vi.fn();
    const edits = port(queued(), { cancelDeferredFollowUpEdit });
    render(edits);
    act(() => current().begin("agt-1", "deferred-1"));
    render({ ...edits, deferredFollowUps: queued(SESSION.lease) });

    act(() => current().begin("agt-1", "deferred-1"));
    expect(cancelDeferredFollowUpEdit).toHaveBeenCalledExactlyOnceWith(SESSION);

    act(() => root.unmount());
    expect(cancelDeferredFollowUpEdit).toHaveBeenCalledTimes(2);
    root = createRoot(host);
  });

  it("releases the lease once another thread is selected and does not resurrect it", () => {
    const cancelDeferredFollowUpEdit = vi.fn();
    const edits = port(queued(), { cancelDeferredFollowUpEdit });
    render(edits);
    act(() => current().begin("agt-1", "deferred-1"));
    render({ ...edits, deferredFollowUps: queued(SESSION.lease) });
    expect(current().edit).not.toBeNull();

    render({ ...edits, deferredFollowUps: queued(SESSION.lease) }, "agt-2");

    expect(cancelDeferredFollowUpEdit).toHaveBeenCalledExactlyOnceWith(SESSION);
    expect(current().edit).toBeNull();
    render({ ...edits, deferredFollowUps: queued(SESSION.lease) }, "agt-1");
    expect(current().edit).toBeNull();
    render({ ...edits, deferredFollowUps: queued() }, null);
    expect(cancelDeferredFollowUpEdit).toHaveBeenCalledTimes(1);
  });
});
