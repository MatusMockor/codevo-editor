// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { agentComposerDraftStore } from "../../application/agentComposerDrafts";
import {
  agentTranscriptTurnPosition,
  type AgentTranscriptPosition,
} from "../../domain/agentTranscriptPosition";
import { BrowserAgentComposerDraftPreference } from "../../infrastructure/browserAgentComposerDraftPreference";
import { BrowserAgentProjectSelectionPreference } from "../../infrastructure/browserAgentProjectSelectionPreference";
import type { KeyValueStorage } from "../../infrastructure/browserSettingsGateway";
import { BrowserAgentTranscriptPositionPreference } from "../../infrastructure/browserAgentTranscriptPositionPreference";
import {
  useAgentSessionRestore,
  type AgentSessionRestore,
  type AgentSessionRestorePorts,
} from "./useAgentSessionRestore";

const PROJECT = "/workspace/app";

describe("useAgentSessionRestore", () => {
  let host: HTMLDivElement;
  let root: Root;
  let captured: AgentSessionRestore | null;
  let storage: KeyValueStorage & { readonly values: Map<string, string> };

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    captured = null;
    storage = memoryStorage();
    agentComposerDraftStore.reset();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    agentComposerDraftStore.reset();
  });

  it("restores the selection ledger, composer drafts and transcript positions of the last session", () => {
    const ports = portsFor(storage);
    ports.projectSelections?.save([
      { projectRootKey: PROJECT, threadId: "agt-1", repositoryRoot: PROJECT },
    ]);
    ports.composerDrafts?.save([["agt-1", "half-written follow-up"]]);
    ports.transcriptPositions?.save([
      { threadId: "agt-1", position: turnPosition("turn-3", -120) },
    ]);

    render(ports);

    expect(restored().navigationSession.restore?.recall(PROJECT)).toEqual({
      projectRootKey: PROJECT,
      threadId: "agt-1",
      repositoryRoot: PROJECT,
    });
    expect(agentComposerDraftStore.readDraft("agt-1")).toBe("half-written follow-up");
    expect(restored().transcriptPositions.read("agt-1")).toEqual(turnPosition("turn-3", -120));
  });

  it("writes every piece back when the window is hidden so the next launch sees it", () => {
    render(portsFor(storage));

    act(() => {
      restored().navigationSession.restore?.remember({
        projectRootKey: PROJECT,
        threadId: "agt-2",
        repositoryRoot: PROJECT,
      });
      agentComposerDraftStore.writeDraft("agt-2", "keep me");
      restored().transcriptPositions.remember("agt-2", turnPosition("turn-1", 0));
    });
    window.dispatchEvent(new Event("pagehide"));

    const next = portsFor(storage);
    expect(next.projectSelections?.load()).toEqual([
      { projectRootKey: PROJECT, threadId: "agt-2", repositoryRoot: PROJECT },
    ]);
    expect(next.composerDrafts?.load()).toEqual([["agt-2", "keep me"]]);
    expect(next.transcriptPositions?.load()).toEqual([
      { threadId: "agt-2", position: turnPosition("turn-1", 0) },
    ]);
  });

  function render(ports: AgentSessionRestorePorts): void {
    act(() => root.render(<Harness ports={ports} />));
  }

  function restored(): AgentSessionRestore {
    expect(captured).not.toBeNull();
    return captured as AgentSessionRestore;
  }

  function Harness({ ports }: { readonly ports: AgentSessionRestorePorts }) {
    captured = useAgentSessionRestore(ports);
    return null;
  }
});

function turnPosition(turnId: string, offsetPx: number): AgentTranscriptPosition {
  const position = agentTranscriptTurnPosition(turnId, offsetPx);
  expect(position).not.toBeNull();
  return position as AgentTranscriptPosition;
}

function portsFor(storage: KeyValueStorage): AgentSessionRestorePorts {
  return {
    projectSelections: new BrowserAgentProjectSelectionPreference(storage),
    composerDrafts: new BrowserAgentComposerDraftPreference(storage),
    transcriptPositions: new BrowserAgentTranscriptPositionPreference(storage),
  };
}

function memoryStorage(): KeyValueStorage & { readonly values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}
