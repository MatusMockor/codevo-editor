// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentContextWindowMeter, type AgentContextWindowUsage } from "./AgentContextWindowMeter";

describe("AgentContextWindowMeter", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it.each([
    null,
    { usedTokens: -1, contextWindow: 100 },
    { usedTokens: 10, contextWindow: 0 },
    { usedTokens: NaN, contextWindow: 100 },
    { usedTokens: 1.5, contextWindow: 100 },
    { usedTokens: 10, contextWindow: Infinity },
  ])("hides unavailable or invalid usage %j", (usage) => {
    render(usage);
    expect(host.querySelector("button")).toBeNull();
  });

  it("shows provider counts with accessible details and restores focus on Escape", () => {
    render({ usedTokens: 120_000, contextWindow: 200_000 });
    const button = host.querySelector("button")!;
    expect(button.getAttribute("aria-label")).toBe("Context window: 60% used");
    expect(button.textContent).toBe("60%");
    act(() => button.click());
    const dialog = host.querySelector('[role="dialog"]')!;
    expect(document.activeElement).toBe(dialog);
    expect(dialog.textContent).toContain("120,000 / 200,000 tokens");
    expect(dialog.textContent).toContain("not compaction progress");
    expect(button.getAttribute("aria-controls")).toBe(dialog.id);
    act(() => dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("shows zero and over-capacity telemetry honestly while bounding the ring", () => {
    render({ usedTokens: 0, contextWindow: 100 });
    expect(host.querySelector("button")?.textContent).toBe("0%");
    render({ usedTokens: 110, contextWindow: 100 });
    expect(host.querySelector("button")?.textContent).toBe("110%");
    expect(host.querySelector("button")?.dataset.highUsage).toBe("true");
    expect(host.querySelector(".agent-context-meter__fill")?.getAttribute("stroke-dasharray")).toBe(
      "100 100",
    );
  });

  it("closes old details across thread replacement and telemetry loss", () => {
    const usage = { usedTokens: 20, contextWindow: 100 };
    render(usage, "A");
    act(() => host.querySelector("button")!.click());
    render(usage, "B");
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    render(usage, "A");
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    act(() => host.querySelector("button")!.click());
    render(null, "A");
    render(usage, "A");
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  it("updates open details on new telemetry and closes on outside interaction", () => {
    render({ usedTokens: 20, contextWindow: 100 });
    act(() => host.querySelector("button")!.click());
    render({ usedTokens: 30, contextWindow: 100 });
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain("30% used");
    act(() => document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  function render(usage: AgentContextWindowUsage | null, ownerKey = "thread") {
    act(() => root.render(<AgentContextWindowMeter ownerKey={ownerKey} usage={usage} />));
  }
});
