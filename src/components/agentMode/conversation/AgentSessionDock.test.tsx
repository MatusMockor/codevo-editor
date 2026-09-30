// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentSessionDock } from "./AgentSessionDock";
import type { AgentSessionEndOffer } from "./agentSessionTaskControls";

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

function buttonLabelled(label: string): HTMLButtonElement | null {
  return (
    [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.getAttribute("aria-label") === label,
    ) ?? null
  );
}

describe("AgentSessionDock", () => {
  it("renders one calm bar with only the count, View and Stop", () => {
    const open = vi.fn();
    const stop = vi.fn();
    act(() =>
      root.render(
        <AgentSessionDock
          activity={{
            label: "4 agents running",
            viewLabel: "View agents",
            actions: ["view", "stop"],
            announce: true,
          }}
          follow={{ atLatest: true, unseenActivity: false, jumpToLatest: () => undefined }}
          onOpenAgents={open}
          onRevealQueue={() => undefined}
          onStop={stop}
          queuedCount={0}
        />,
      ),
    );

    const bars = host.querySelectorAll(".cv-session-dock__banners .cv-composer-banner");
    expect(bars).toHaveLength(1);
    expect(bars[0]?.className).toContain("cv-composer-banner--working");
    expect(bars[0]?.querySelectorAll(".cv-spinner")).toHaveLength(1);
    expect(bars[0]?.getAttribute("role")).toBe("status");
    expect(bars[0]?.textContent).toBe("4 agents runningViewStop");
    expect(bars[0]?.querySelector('[role="list"]')).toBeNull();
    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="View agents"]')?.click());
    expect(open).toHaveBeenCalledTimes(1);
    act(() =>
      host
        .querySelector<HTMLButtonElement>('button[aria-label="Stop agent and background work"]')
        ?.click(),
    );
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("omits Stop when the bar has no background work or no stop port", () => {
    const render = (actions: ReadonlyArray<"view" | "stop">, onStop?: () => void) =>
      act(() =>
        root.render(
          <AgentSessionDock
            activity={{
              label: "1 agent running",
              viewLabel: "View agents",
              actions,
              announce: false,
            }}
            follow={{ atLatest: true, unseenActivity: false, jumpToLatest: () => undefined }}
            onOpenAgents={() => undefined}
            onRevealQueue={() => undefined}
            onStop={onStop}
            queuedCount={0}
          />,
        ),
      );
    render(["view"], () => undefined);
    expect(host.querySelector('button[aria-label="Stop agent and background work"]')).toBeNull();
    expect(host.querySelector(".cv-composer-banner")?.getAttribute("role")).toBeNull();
    render(["view", "stop"]);
    expect(host.querySelector('button[aria-label="Stop agent and background work"]')).toBeNull();
    expect(host.querySelectorAll(".cv-composer-banner")).toHaveLength(1);
  });

  it("shows jump-to-latest only away from the latest message and the queue count only when queued", () => {
    const jump = vi.fn();
    act(() =>
      root.render(
        <AgentSessionDock
          activity={null}
          follow={{ atLatest: false, unseenActivity: true, jumpToLatest: jump }}
          onOpenAgents={() => undefined}
          onRevealQueue={() => undefined}
          queuedCount={2}
        />,
      ),
    );

    expect(host.querySelector(".agent-jump-latest__button")?.textContent).toBe("New activity");
    expect(host.querySelector('button[aria-label="Show 2 queued messages"]')?.textContent).toBe(
      "2 queued",
    );
    expect(host.querySelector(".cv-session-dock__banners")).toBeNull();
  });

  it("offers End session next to View, emphasised when suggested, and hides it otherwise", () => {
    const endSession = vi.fn();
    const render = (offer: AgentSessionEndOffer, onEnd: (() => void) | null = endSession) =>
      act(() =>
        root.render(
          <AgentSessionDock
            activity={{
              label: "1 background task running",
              viewLabel: "View background tasks",
              actions: ["view"],
              announce: false,
            }}
            endSession={offer}
            follow={{ atLatest: true, unseenActivity: false, jumpToLatest: () => undefined }}
            onEndSession={onEnd ?? undefined}
            onOpenAgents={() => undefined}
            onRevealQueue={() => undefined}
            queuedCount={0}
          />,
        ),
      );
    render("offered");
    expect(buttonLabelled("View background tasks")).not.toBeNull();
    expect(host.querySelector(".cv-composer-banner")?.textContent).toBe(
      "1 background task runningViewEnd session",
    );
    act(() => buttonLabelled("End Claude session")?.click());
    expect(endSession).toHaveBeenCalledTimes(1);
    render("suggested");
    expect(buttonLabelled("End Claude session")?.className).toContain("cv-banner-action--emphasis");
    render("hidden");
    expect(buttonLabelled("End Claude session")).toBeNull();
    render("offered", null);
    expect(buttonLabelled("End Claude session")).toBeNull();
  });
});
