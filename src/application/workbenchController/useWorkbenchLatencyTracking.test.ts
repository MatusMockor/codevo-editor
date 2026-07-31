import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useRef } from "react";
import type { LatencyTracker } from "../../domain/latencyTracker";
import {
  useWorkbenchLatencyReporting,
  useWorkbenchLatencyTrackerForRoot,
} from "./useWorkbenchLatencyTracking";

function setup() {
  return renderHook(() => {
    const currentWorkspaceRootRef = useRef<string | null>("/tmp/project");
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
    return { latencyTrackerForRoot, reporting };
  });
}

describe("clearLatencyMetrics", () => {
  it("clears the current root tracker", () => {
    const { result } = setup();
    result.current.latencyTrackerForRoot("/tmp/project").record("completion", 5);
    expect(result.current.reporting.getLatencySnapshot()).toHaveLength(1);
    result.current.reporting.clearLatencyMetrics();
    expect(result.current.reporting.getLatencySnapshot()).toHaveLength(0);
  });
});
