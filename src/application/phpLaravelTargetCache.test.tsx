// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import type { PhpLaravelViewTarget } from "../domain/phpLaravelViews";
import { usePhpLaravelTargetCache } from "./phpLaravelTargetCache";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const ROOT_A = "/workspace-a";
const ROOT_B = "/workspace-b";

const VIEW_TARGETS: PhpLaravelViewTarget[] = [
  {
    name: "welcome",
    path: `${ROOT_A}/resources/views/welcome.blade.php`,
    relativePath: "resources/views/welcome.blade.php",
  },
];

type CacheApi = ReturnType<typeof usePhpLaravelTargetCache>;

function renderTargetCache(initialRoot: string | null) {
  const container = document.createElement("div");
  const root = createRoot(container);
  const currentWorkspaceRootRef = { current: initialRoot };
  const captured: { api: CacheApi | null } = { api: null };

  function Harness() {
    captured.api = usePhpLaravelTargetCache(currentWorkspaceRootRef);
    return null;
  }

  act(() => {
    root.render(<Harness />);
  });

  return {
    cache: () => {
      expect(captured.api).not.toBeNull();

      return captured.api as CacheApi;
    },
    currentWorkspaceRootRef,
    unmount: () => {
      act(() => {
        root.unmount();
      });
    },
  };
}

describe("usePhpLaravelTargetCache", () => {
  it("serves cached targets while the requested root stays active", () => {
    const harness = renderTargetCache(ROOT_A);

    harness.cache().write(ROOT_A, "views", VIEW_TARGETS);

    expect(harness.cache().read(ROOT_A, "views")).toEqual(VIEW_TARGETS);
    harness.unmount();
  });

  it("refuses to serve a cached root after another workspace becomes active", () => {
    const harness = renderTargetCache(ROOT_A);

    harness.cache().write(ROOT_A, "views", VIEW_TARGETS);
    harness.currentWorkspaceRootRef.current = ROOT_B;

    expect(harness.cache().read(ROOT_A, "views")).toBeNull();
    expect(harness.cache().read(ROOT_B, "views")).toBeNull();
    harness.unmount();
  });

  it("drops a write for a root that is no longer active", () => {
    const harness = renderTargetCache(ROOT_A);

    harness.currentWorkspaceRootRef.current = ROOT_B;
    harness.cache().write(ROOT_A, "views", VIEW_TARGETS);
    harness.currentWorkspaceRootRef.current = ROOT_A;

    expect(harness.cache().read(ROOT_A, "views")).toBeNull();
    harness.unmount();
  });

  it("clears every cached root on invalidate", () => {
    const harness = renderTargetCache(ROOT_A);

    harness.cache().write(ROOT_A, "views", VIEW_TARGETS);
    harness.cache().invalidate();

    expect(harness.cache().read(ROOT_A, "views")).toBeNull();
    harness.unmount();
  });
});
