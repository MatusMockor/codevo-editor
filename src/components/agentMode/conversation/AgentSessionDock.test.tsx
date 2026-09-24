// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentSessionDock } from "./AgentSessionDock";

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

describe("AgentSessionDock", () => {
  it("attaches the agents banner above the composer and opens the panel from View", () => {
    const open = vi.fn();
    act(() =>
      root.render(
        <AgentSessionDock
          agents={{ label: "2 agents running", names: "explorer, reviewer" }}
          background={null}
          follow={{ atLatest: true, unseenActivity: false, jumpToLatest: () => undefined }}
          onOpenAgents={open}
          onRevealQueue={() => undefined}
          queuedCount={0}
        />,
      ),
    );

    const banner = host.querySelector(".cv-session-dock__banners .cv-composer-banner");
    expect(banner?.className).toContain("cv-composer-banner--working");
    expect(banner?.textContent).toBe("2 agents runningexplorer, reviewerView");
    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="View agents"]')?.click());
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("shows jump-to-latest only away from the latest message and the queue count only when queued", () => {
    const jump = vi.fn();
    act(() =>
      root.render(
        <AgentSessionDock
          agents={null}
          background={null}
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
});
