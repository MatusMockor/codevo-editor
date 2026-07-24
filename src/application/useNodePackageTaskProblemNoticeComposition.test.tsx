// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { createWorkbenchNotice, type WorkbenchNotice } from "./workbenchNotice";
import { useNodePackageTaskProblemNoticeComposition } from "./useNodePackageTaskProblemNoticeComposition";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("useNodePackageTaskProblemNoticeComposition", () => {
  it("keeps manual Clear Problems empty until a new backend snapshot identity arrives", () => {
    const root = createRoot(document.createElement("div"));
    const first = [notice("first")];
    let replacements: readonly WorkbenchNotice[] = first;
    let current: WorkbenchNotice[] = [];
    let clear: () => void = () => undefined;
    function Harness() {
      const [notices, setNotices] = useState<WorkbenchNotice[]>([]);
      current = notices;
      clear = () => setNotices([]);
      useNodePackageTaskProblemNoticeComposition(replacements, setNotices);
      return null;
    }
    act(() => root.render(<Harness />));
    expect(current.map(({ message }) => message)).toEqual(["first"]);
    act(() => clear());
    expect(current).toEqual([]);
    act(() => root.render(<Harness />));
    expect(current).toEqual([]);
    replacements = [notice("second")];
    act(() => root.render(<Harness />));
    expect(current.map(({ message }) => message)).toEqual(["second"]);
    act(() => root.unmount());
  });
});

function notice(message: string): WorkbenchNotice {
  return createWorkbenchNotice(
    "error",
    "TypeScript",
    message,
    "node-package-task-problems:ws:run",
  );
}
