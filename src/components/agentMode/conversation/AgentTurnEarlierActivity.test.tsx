// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openAgentTurnActivityWindow } from "../../../domain/agentTurnActivityWindow";
import { AGENT_TURN_REMOTE_DISCARDED_NOTICE } from "../agentTurnLogNotice";
import { AgentTurnEarlierControl, AgentTurnLaterControl } from "./AgentTurnEarlierActivity";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const window = openAgentTurnActivityWindow({
  entries: [
    { seq: 5, event: { kind: "toolCall", toolId: "t5", name: "Bash", inputSummary: "ls" } },
  ],
  firstSeq: 5,
  lastSeq: 5,
  hasEarlier: true,
  hasLater: true,
  loss: { kind: "none" },
  clipped: false,
});

describe("AgentTurnEarlierControl", () => {
  it("reveals retained rows first, then pages the log, with the label as the loading state", () => {
    const reveal = vi.fn();
    const load = vi.fn();
    act(() =>
      root.render(
        <AgentTurnEarlierControl
          canRevealMemory
          hiddenCount={300}
          logAvailable
          onLoadEarlier={load}
          onRevealMemory={reveal}
          state={{ kind: "latest" }}
        />,
      ),
    );
    act(() => host.querySelector<HTMLButtonElement>("button.cv-load-earlier")?.click());
    expect(reveal).toHaveBeenCalledTimes(1);
    expect(load).not.toHaveBeenCalled();

    act(() =>
      root.render(
        <AgentTurnEarlierControl
          canRevealMemory={false}
          hiddenCount={0}
          logAvailable
          onLoadEarlier={load}
          onRevealMemory={reveal}
          state={{ kind: "loading", direction: "earlier", window: null }}
        />,
      ),
    );
    const button = host.querySelector<HTMLButtonElement>("button.cv-load-earlier");
    expect(button?.textContent).toBe("Loading earlier activity…");
    expect(button?.disabled).toBe(true);
  });

  it("offers a retry after a failed page and says when saved activity has a gap", () => {
    const load = vi.fn();
    act(() =>
      root.render(
        <AgentTurnEarlierControl
          canRevealMemory={false}
          hiddenCount={0}
          logAvailable
          onLoadEarlier={load}
          onRevealMemory={() => undefined}
          state={{ kind: "failed", direction: "earlier", window: { ...window, gap: true } }}
        />,
      ),
    );
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Could not load earlier activity.",
    );
    act(() =>
      [...host.querySelectorAll("button")]
        .find((candidate) => candidate.textContent === "Retry")
        ?.click(),
    );
    expect(load).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("Some activity is missing from the saved history.");
  });

  it("says the server discarded earlier activity once a window reached that point", () => {
    const render = (earlierDiscarded: boolean) =>
      act(() =>
        root.render(
          <AgentTurnEarlierControl
            canRevealMemory={false}
            hiddenCount={0}
            logAvailable
            onLoadEarlier={() => undefined}
            onRevealMemory={() => undefined}
            state={{
              kind: "ready",
              window: {
                ...window,
                hasEarlier: false,
                ...(earlierDiscarded ? { earlierDiscarded } : {}),
              },
            }}
          />,
        ),
      );

    render(true);
    expect(host.querySelector(".agent-note--warning")?.textContent).toBe(
      AGENT_TURN_REMOTE_DISCARDED_NOTICE,
    );
    expect(host.querySelector("button.cv-load-earlier")).toBeNull();

    render(false);
    expect(host.innerHTML).toBe("");
  });

  it("renders nothing when there is nothing earlier to show", () => {
    act(() =>
      root.render(
        <AgentTurnEarlierControl
          canRevealMemory={false}
          hiddenCount={0}
          logAvailable={false}
          onLoadEarlier={() => undefined}
          onRevealMemory={() => undefined}
          state={{ kind: "latest" }}
        />,
      ),
    );
    expect(host.innerHTML).toBe("");
  });
});

describe("AgentTurnLaterControl", () => {
  it("offers later and latest activity for a window that is not at the tail", () => {
    const later = vi.fn();
    const latest = vi.fn();
    act(() =>
      root.render(
        <AgentTurnLaterControl
          onLatest={latest}
          onLoadLater={later}
          running={false}
          state={{ kind: "ready", window }}
        />,
      ),
    );
    const buttons = [...host.querySelectorAll("button")].map((button) => button.textContent);
    expect(buttons).toEqual(["Show later activity", "Show latest activity"]);
  });

  it("offers the latest activity again while the turn is still running", () => {
    act(() =>
      root.render(
        <AgentTurnLaterControl
          onLatest={() => undefined}
          onLoadLater={() => undefined}
          running
          state={{ kind: "ready", window: { ...window, hasLater: false } }}
        />,
      ),
    );
    expect([...host.querySelectorAll("button")].map((button) => button.textContent)).toEqual([
      "Show latest activity",
    ]);
  });
});
