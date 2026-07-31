// @vitest-environment jsdom

import { act, createElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { LatencyTracker } from "../../domain/latencyTracker";
import {
  useWorkbenchLatencyReporting,
  useWorkbenchLatencyTrackerForRoot,
} from "./useWorkbenchLatencyTracking";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const ROOT = "/tmp/project";

type LatencyTrackerForRoot = ReturnType<typeof useWorkbenchLatencyTrackerForRoot>;
type LatencyReporting = ReturnType<typeof useWorkbenchLatencyReporting>;

let mountedRoot: Root | null = null;
let container: HTMLDivElement | null = null;

function renderHook() {
  container = document.createElement("div");
  mountedRoot = createRoot(container);
  const captured: {
    latencyTrackerForRoot: LatencyTrackerForRoot | null;
    reporting: LatencyReporting | null;
  } = {
    latencyTrackerForRoot: null,
    reporting: null,
  };

  function Harness() {
    const currentWorkspaceRootRef = useRef<string | null>(ROOT);
    const latencyTrackersByRootRef = useRef<Record<string, LatencyTracker>>({});
    const latencyTrackerForRoot = useWorkbenchLatencyTrackerForRoot({
      currentWorkspaceRootRef,
      latencyTrackersByRootRef,
    });
    const reporting = useWorkbenchLatencyReporting({
      currentWorkspaceRootRef,
      latencyTrackersByRootRef,
      latencyTrackerForRoot,
    });
    captured.latencyTrackerForRoot = latencyTrackerForRoot;
    captured.reporting = reporting;
    return null;
  }

  act(() => {
    mountedRoot?.render(createElement(Harness));
  });

  return {
    latencyTrackerForRoot: (): LatencyTrackerForRoot => {
      if (!captured.latencyTrackerForRoot) {
        throw new Error("hook not mounted");
      }

      return captured.latencyTrackerForRoot;
    },
    reporting: (): LatencyReporting => {
      if (!captured.reporting) {
        throw new Error("hook not mounted");
      }

      return captured.reporting;
    },
  };
}

afterEach(() => {
  if (mountedRoot) {
    act(() => {
      mountedRoot?.unmount();
    });
  }

  mountedRoot = null;
  container?.remove();
  container = null;
});

describe("clearLatencyMetrics", () => {
  it("clears the current root tracker", () => {
    const hook = renderHook();
    hook.latencyTrackerForRoot()(ROOT).record("completion", 5);
    expect(hook.reporting().getLatencySnapshot()).toHaveLength(1);
    hook.reporting().clearLatencyMetrics();
    expect(hook.reporting().getLatencySnapshot()).toHaveLength(0);
  });
});
