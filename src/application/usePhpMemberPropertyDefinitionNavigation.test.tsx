// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import {
  usePhpMemberPropertyDefinitionNavigation,
  type PhpMemberPropertyDefinitionNavigation,
  type PhpMemberPropertyDefinitionNavigationDependencies,
} from "./usePhpMemberPropertyDefinitionNavigation";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const ROOT = "/workspace";
const OTHER_ROOT = "/other";

function makeDeps(
  overrides: Partial<PhpMemberPropertyDefinitionNavigationDependencies> = {},
): PhpMemberPropertyDefinitionNavigationDependencies {
  return {
    activeDocument: {
      content: "<?php $comment->author;",
      language: "php",
      name: "Controller.php",
      path: `${ROOT}/app/Controller.php`,
      savedContent: "",
    },
    activeEditorPositionRef: { current: { column: 1, lineNumber: 1 } },
    currentWorkspaceRootRef: { current: ROOT },
    openDirectPhpMethodTarget: vi.fn(async () => false),
    openDirectPhpPropertyTarget: vi.fn(async () => false),
    openPhpClassTarget: vi.fn(async () => true),
    openPhpLaravelModelAttributeTarget: vi.fn(async () => false),
    phpClassHierarchyHasProperty: vi.fn(async () => true),
    resolvePhpExpressionType: vi
      .fn()
      .mockResolvedValueOnce("App\\Models\\Comment")
      .mockResolvedValueOnce("App\\Models\\User"),
    setMessage: vi.fn(),
    workspaceRoot: ROOT,
    ...overrides,
  };
}

function renderHook(deps: PhpMemberPropertyDefinitionNavigationDependencies) {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: { api: PhpMemberPropertyDefinitionNavigation | null } = {
    api: null,
  };

  function Harness({
    dependencies,
  }: {
    dependencies: PhpMemberPropertyDefinitionNavigationDependencies;
  }) {
    captured.api = usePhpMemberPropertyDefinitionNavigation(dependencies);
    return null;
  }

  act(() => {
    root.render(<Harness dependencies={deps} />);
  });

  const api = (): PhpMemberPropertyDefinitionNavigation => {
    if (!captured.api) {
      throw new Error("hook not mounted");
    }

    return captured.api;
  };

  return {
    api,
    unmount: () => {
      act(() => {
        root.unmount();
      });
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });

  return { promise, resolve };
}

describe("usePhpMemberPropertyDefinitionNavigation", () => {
  it("opens the typed property class before falling back to the declaration", async () => {
    const openPhpClassTarget = vi.fn(async () => true);
    const deps = makeDeps({ openPhpClassTarget });
    const harness = renderHook(deps);

    const handled = await harness.api().goToPhpMemberPropertyDefinition({
      kind: "memberPropertyAccess",
      propertyName: "author",
      receiverExpression: "$comment",
      variableName: "comment",
    });

    expect(handled).toBe(true);
    expect(openPhpClassTarget).toHaveBeenCalledWith("App\\Models\\User", "User");
    expect(deps.openDirectPhpPropertyTarget).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("opens Laravel model attribute targets before typed property classes", async () => {
    const openPhpLaravelModelAttributeTarget = vi.fn(async () => true);
    const openPhpClassTarget = vi.fn(async () => true);
    const deps = makeDeps({
      openPhpClassTarget,
      openPhpLaravelModelAttributeTarget,
    });
    const harness = renderHook(deps);

    const handled = await harness.api().goToPhpMemberPropertyDefinition({
      kind: "memberPropertyAccess",
      propertyName: "author",
      receiverExpression: "$comment",
      variableName: "comment",
    });

    expect(handled).toBe(true);
    expect(openPhpLaravelModelAttributeTarget).toHaveBeenCalledWith(
      "App\\Models\\Comment",
      "author",
    );
    expect(openPhpClassTarget).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("drops property navigation when workspace changes mid-resolution", async () => {
    const receiverType = deferred<string | null>();
    const currentWorkspaceRootRef = { current: ROOT };
    const openDirectPhpMethodTarget = vi.fn(async () => true);
    const deps = makeDeps({
      currentWorkspaceRootRef,
      openDirectPhpMethodTarget,
      resolvePhpExpressionType: vi.fn(() => receiverType.promise),
    });
    const harness = renderHook(deps);
    const navigationPromise = harness.api().goToPhpMemberPropertyDefinition({
      kind: "memberPropertyAccess",
      propertyName: "author",
      receiverExpression: "$comment",
      variableName: "comment",
    });

    currentWorkspaceRootRef.current = OTHER_ROOT;
    receiverType.resolve("App\\Models\\Comment");

    await expect(navigationPromise).resolves.toBe(false);
    expect(openDirectPhpMethodTarget).not.toHaveBeenCalled();

    harness.unmount();
  });
});
