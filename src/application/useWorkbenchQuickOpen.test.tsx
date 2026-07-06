// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { createLatencyTracker } from "../domain/latencyTracker";
import {
  useWorkbenchQuickOpen,
  type WorkbenchQuickOpen,
  type WorkbenchQuickOpenDependencies,
} from "./useWorkbenchQuickOpen";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function makeDeps(
  overrides: Partial<WorkbenchQuickOpenDependencies> = {},
): WorkbenchQuickOpenDependencies {
  return {
    fileSearch: {
      searchFiles: vi.fn(async () => []),
    },
    latencyTrackerForRoot: () => createLatencyTracker(),
    reportError: vi.fn(),
    setMessage: vi.fn(),
    workspaceRoot: "/workspace",
    ...overrides,
  };
}

interface Harness {
  quickOpen: () => WorkbenchQuickOpen;
  rerender(deps: WorkbenchQuickOpenDependencies): void;
  unmount(): void;
}

function renderQuickOpen(deps: WorkbenchQuickOpenDependencies): Harness {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: { quickOpen: WorkbenchQuickOpen | null } = {
    quickOpen: null,
  };

  function HarnessComponent({
    deps,
  }: {
    deps: WorkbenchQuickOpenDependencies;
  }) {
    captured.quickOpen = useWorkbenchQuickOpen(deps);
    return null;
  }

  act(() => {
    root.render(<HarnessComponent deps={deps} />);
  });

  return {
    quickOpen: () => {
      if (!captured.quickOpen) {
        throw new Error("Quick Open hook is not mounted");
      }

      return captured.quickOpen;
    },
    rerender: (nextDeps) => {
      act(() => {
        root.render(<HarnessComponent deps={nextDeps} />);
      });
    },
    unmount: () => {
      act(() => {
        root.unmount();
      });
    },
  };
}

describe("useWorkbenchQuickOpen", () => {
  it("clears transient workbench messages when Quick Open closes", () => {
    const deps = makeDeps();
    const harness = renderQuickOpen(deps);

    act(() => {
      harness.quickOpen().setQuickOpenOpen(true);
    });

    expect(deps.setMessage).not.toHaveBeenCalled();

    act(() => {
      harness.quickOpen().setQuickOpenOpen(false);
    });

    expect(deps.setMessage).toHaveBeenCalledWith(null);

    harness.unmount();
  });
});
