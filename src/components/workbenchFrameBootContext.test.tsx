// @vitest-environment jsdom

import { createRoot } from "react-dom/client";
import { act, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  WORKBENCH_SURFACE_ENTER_CLASS,
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

afterEach(() => {
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
    createRoot(container).render(<Frame mountLate={mountLate} />);
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
