// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentTurn } from "../../domain/agentThread";
import { AgentArtifactPreviewScope } from "./AgentOutputArtifacts";
import { AgentTurnArtifacts, type AgentArtifactScope } from "./AgentTurnArtifacts";

describe("turn artifact integration", () => {
  let host: HTMLDivElement;
  let root: Root;
  const resolve = vi.fn().mockRejectedValue(new Error("Unavailable"));
  const scope: AgentArtifactScope = {
    owner: { rootKey: "/repo", repositoryRoot: "/repo", ownerId: "workspace" },
    threadId: "thread",
    serverId: undefined,
    runnerId: undefined,
    loader: { resolve, read: vi.fn() },
    preview: { prepare: vi.fn() },
  };
  const turn: AgentTurn = {
    turnId: "turn",
    prompt: "![user](private.png)",
    status: { kind: "exited", exitCode: 0 },
    events: [],
    startedAtEpochMs: 0,
    endedAtEpochMs: 1,
    eventsTruncated: false,
    lastStatusSequence: 1,
    lastOutputSequence: 1,
    launch: null,
    cliVersion: null,
  };
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    resolve.mockClear();
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });
  function render(events: AgentTurn["events"], currentScope = scope) {
    act(() =>
      root.render(
        <AgentArtifactPreviewScope>
          <AgentTurnArtifacts scope={currentScope} turn={{ ...turn, events }} />
        </AgentArtifactPreviewScope>,
      ),
    );
  }
  it("collects split assistant references and deduplicates final result", () => {
    render([
      { kind: "assistantText", text: "[Design](art" },
      { kind: "assistantText", text: "ifacts/view.html)" },
      { kind: "result", text: "[Design](artifacts/view.html)", isError: false, usage: null },
    ]);
    expect(host.querySelectorAll(".agent-artifacts__chip")).toHaveLength(1);
    expect(host.querySelector(".agent-artifacts__name")?.textContent).toBe("Design");
    expect(resolve).not.toHaveBeenCalled();
  });
  it("never treats user text or tool output as artifact authority", () => {
    render([
      { kind: "userMessage", text: "![user](private.png)" },
      {
        kind: "toolResult",
        toolId: "tool",
        outputSummary: "[secret](secrets.html)",
        isError: false,
      },
    ]);
    expect(host.textContent).toBe("");
  });
  it("routes each remote turn to its original runner and task", async () => {
    render([{ kind: "assistantText", text: "![Image](result.png)" }], {
      ...scope,
      serverId: "server",
      runnerId: "runner",
    });
    await act(async () => host.querySelector<HTMLButtonElement>(".agent-artifacts__chip")!.click());
    expect(resolve).toHaveBeenCalledWith(
      { kind: "remote", serverId: "server", runnerId: "runner", taskId: "turn" },
      "result.png",
    );
  });
  it("routes local files through the persisted owner and turn", async () => {
    render([{ kind: "assistantText", text: "[Design](result.html)" }]);
    await act(async () => host.querySelector<HTMLButtonElement>(".agent-artifacts__chip")!.click());
    expect(resolve).toHaveBeenCalledWith(
      { kind: "local", ...scope.owner, threadId: "thread", turnId: "turn" },
      "result.html",
    );
  });
});
