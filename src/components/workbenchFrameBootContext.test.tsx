// @vitest-environment jsdom

import { createRoot, type Root } from "react-dom/client";
import { act, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  WORKBENCH_SURFACE_ENTER_CLASS,
  WORKBENCH_SURFACE_ENTER_TIMEOUT_MS,
  WorkbenchFrameBootContext,
  useSurfaceEnterClass,
  useWorkbenchFrameBooted,
} from "./workbenchFrameBootContext";
import {
  buildTokenTable,
  lastOf,
  parseAllStyleSheets,
  selectorParts,
} from "./cssContractTestSupport";

const AGENT_SHEET = "components/agentMode/agentMode.css";
const agentRules = parseAllStyleSheets().rules.filter((rule) => rule.sheet === AGENT_SHEET);

function agentDeclaration(selector: string, property: string): string | undefined {
  return lastOf(
    buildTokenTable(
      agentRules.filter(
        (rule) => rule.context.length === 0 && selectorParts(rule.selector).includes(selector),
      ),
      "",
    ).get(property),
  );
}

let host: HTMLElement | null = null;
let root: Root | null = null;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.useRealTimers();
  host?.remove();
  host = null;
});

function Surface() {
  return <div className={["surface", useSurfaceEnterClass()].filter(Boolean).join(" ")} />;
}

function Frame({ mountLate }: { readonly mountLate: boolean }) {
  const booted = useWorkbenchFrameBooted();
  const [late, setLate] = useState(false);
  return (
    <WorkbenchFrameBootContext.Provider value={booted}>
      <button onClick={() => setLate(true)} type="button">
        mount
      </button>
      {mountLate && !late ? null : <Surface />}
    </WorkbenchFrameBootContext.Provider>
  );
}

function render(mountLate: boolean): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  host = container;
  act(() => {
    root = createRoot(container);
    root.render(<Frame mountLate={mountLate} />);
  });
  return container;
}

describe("workbench frame boot phase", () => {
  it("does not animate a surface that mounts during the first commit", () => {
    const container = render(false);

    expect(container.querySelector(".surface")?.className).toBe("surface");
  });

  it("animates a surface that mounts after the frame has booted", () => {
    const container = render(true);
    expect(container.querySelector(".surface")).toBeNull();

    act(() => {
      container.querySelector("button")?.click();
    });

    expect(container.querySelector(".surface")?.className).toBe(
      `surface ${WORKBENCH_SURFACE_ENTER_CLASS}`,
    );
  });

  it("keeps a mounted surface frozen, so a later boot flag cannot retrigger the animation", () => {
    const container = render(false);

    act(() => {
      container.querySelector("button")?.click();
    });

    expect(container.querySelector(".surface")?.className).toBe("surface");
  });

  it("clears a stalled entrance without waiting for animationend and never retriggers it", () => {
    const container = render(true);
    act(() => container.querySelector("button")?.click());
    expect(
      container.querySelector(".surface")?.classList.contains(WORKBENCH_SURFACE_ENTER_CLASS),
    ).toBe(true);
    act(() => vi.advanceTimersByTime(WORKBENCH_SURFACE_ENTER_TIMEOUT_MS));
    expect(container.querySelector(".surface")?.className).toBe("surface");
    act(() => container.querySelector("button")?.click());
    expect(container.querySelector(".surface")?.className).toBe("surface");
  });

  it("releases the entrance deadline when the surface unmounts", () => {
    const container = render(true);
    act(() => container.querySelector("button")?.click());
    expect(vi.getTimerCount()).toBe(1);
    act(() => root?.unmount());
    root = null;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("gates the agent enter animation on the enter class only", () => {
    expect(agentDeclaration(".agent-mode", "animation")).toBeUndefined();
    expect(agentDeclaration(".agent-surface-host", "animation")).toBeUndefined();
    expect(agentDeclaration(`.agent-mode.${WORKBENCH_SURFACE_ENTER_CLASS}`, "animation")).toContain(
      "agent-mode-enter",
    );
    expect(
      agentDeclaration(`.agent-surface-host.${WORKBENCH_SURFACE_ENTER_CLASS}`, "animation"),
    ).toContain("agent-mode-enter");
  });
});
