// @vitest-environment jsdom

import { act, useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { createWorkbenchNotice, type WorkbenchNotice } from "./workbenchNotice";
import { useJsTestProblemNoticeComposition } from "./useJsTestProblemNoticeComposition";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("useJsTestProblemNoticeComposition", () => {
  it("composes only when a new snapshot notice identity arrives", () => {
    const root = createRoot(document.createElement("div"));
    const first = [notice("first")];
    let replacements: readonly WorkbenchNotice[] = first;
    let current: WorkbenchNotice[] = [];
    let clear: () => void = () => undefined;
    function Harness() {
      const [notices, setNotices] = useState<WorkbenchNotice[]>([]);
      current = notices;
      clear = () => setNotices([]);
      const replaceNotices = useCallback((next: readonly WorkbenchNotice[]) => {
        setNotices((existing) => [
          ...next,
          ...existing.filter((notice) => !notice.groupKey?.startsWith("js-test-problems:")),
        ]);
      }, []);
      useJsTestProblemNoticeComposition(
        replacements,
        notices.some(({ groupKey }) => groupKey?.startsWith("js-test-problems:")),
        replaceNotices,
      );
      return null;
    }

    act(() => root.render(<Harness />));
    expect(current.map(({ message }) => message)).toEqual(["first"]);
    act(() => clear());
    expect(current).toEqual([]);
    act(() => root.render(<Harness />));
    expect(current).toEqual([]);
    const second = [notice("second")];
    replacements = second;
    act(() => root.render(<Harness />));
    expect(current.map(({ message }) => message)).toEqual(["second"]);
    replacements = first;
    act(() => root.render(<Harness />));
    expect(current).toEqual([]);
    replacements = [notice("first rerun")];
    act(() => root.render(<Harness />));
    expect(current.map(({ message }) => message)).toEqual(["first rerun"]);
    act(() => root.unmount());
  });

  it("remembers a manual clear per snapshot across an A to B to A workspace cycle", () => {
    const root = createRoot(document.createElement("div"));
    const workspaceA = [workspaceNotice("workspace-a", "A failure")];
    const workspaceB = [workspaceNotice("workspace-b", "B failure")];
    let replacements: readonly WorkbenchNotice[] = workspaceA;
    let current: WorkbenchNotice[] = [];
    let clear: () => void = () => undefined;

    function Harness() {
      const [notices, setNotices] = useState<WorkbenchNotice[]>([]);
      current = notices;
      clear = () => setNotices([]);
      const replaceNotices = useCallback((next: readonly WorkbenchNotice[]) => {
        setNotices((existing) => [
          ...next,
          ...existing.filter((notice) => !notice.groupKey?.startsWith("js-test-problems:")),
        ]);
      }, []);
      const activeGroupKey = replacements[0]?.groupKey;
      useJsTestProblemNoticeComposition(
        replacements,
        Boolean(activeGroupKey && notices.some(({ groupKey }) => groupKey === activeGroupKey)),
        replaceNotices,
      );
      return null;
    }

    act(() => root.render(<Harness />));
    expect(current.map(({ message }) => message)).toEqual(["A failure"]);

    act(() => clear());
    expect(current).toEqual([]);

    replacements = workspaceB;
    act(() => root.render(<Harness />));
    expect(current.map(({ message }) => message)).toEqual(["B failure"]);

    replacements = workspaceA;
    act(() => root.render(<Harness />));
    expect(current).toEqual([]);

    replacements = workspaceB;
    act(() => root.render(<Harness />));
    expect(current.map(({ message }) => message)).toEqual(["B failure"]);

    replacements = [workspaceNotice("workspace-a", "A rerun failure")];
    act(() => root.render(<Harness />));
    expect(current.map(({ message }) => message)).toEqual(["A rerun failure"]);

    act(() => root.unmount());
  });
});

function notice(message: string): WorkbenchNotice {
  return createWorkbenchNotice(
    "error",
    "JavaScript Tests",
    message,
    "js-test-problems:workspace:run",
  );
}

function workspaceNotice(workspaceId: string, message: string): WorkbenchNotice {
  return createWorkbenchNotice(
    "error",
    "JavaScript Tests",
    message,
    `js-test-problems:${workspaceId}:run`,
  );
}
