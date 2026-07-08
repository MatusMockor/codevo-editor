// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceDescriptor } from "../domain/workspace";
import {
  usePhpContextualMemberDefinitionNavigation,
  type PhpContextualMemberDefinitionNavigation,
  type PhpContextualMemberDefinitionNavigationDependencies,
} from "./usePhpContextualMemberDefinitionNavigation";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const ROOT = "/workspace";
const OTHER_ROOT = "/other";

function makeDescriptor(): WorkspaceDescriptor {
  return {
    javaScriptTypeScript: null,
    php: {
      classmapRoots: [],
      hasComposer: true,
      packageName: null,
      packages: [],
      phpPlatformVersion: null,
      phpVersionConstraint: null,
      psr4Roots: [{ dev: false, namespace: "App\\", paths: [`${ROOT}/app`] }],
    },
    rootPath: ROOT,
  };
}

function makeDeps(
  overrides: Partial<PhpContextualMemberDefinitionNavigationDependencies> = {},
): PhpContextualMemberDefinitionNavigationDependencies {
  return {
    activeDocument: {
      content: "<?php class Child extends ParentClass {}",
      language: "php",
      name: "Child.php",
      path: `${ROOT}/app/Child.php`,
      savedContent: "",
    },
    activeEditorPositionRef: { current: { column: 1, lineNumber: 1 } },
    currentWorkspaceRootRef: { current: ROOT },
    isLaravelFrameworkActive: true,
    openDirectPhpMethodTarget: vi.fn(async () => false),
    openNavigationTarget: vi.fn(async () => true),
    openPhpClassTarget: vi.fn(async () => true),
    openPhpLaravelDynamicWhereTarget: vi.fn(async () => false),
    openPhpMethodHintTarget: vi.fn(async () => false),
    readNavigationFileContent: vi.fn(async () => ""),
    resolvePhpClassReference: vi.fn((_source, className) =>
      className === "parent" ? "App\\ParentClass" : className,
    ),
    resolvePhpClassSourcePaths: vi.fn(async () => []),
    resolvePhpEloquentBuilderModelType: vi.fn(async () => null),
    resolvePhpExpressionType: vi.fn(async () => null),
    resolvePhpLaravelRelationPathOwnerType: vi.fn(async () => null),
    setMessage: vi.fn(),
    workspaceDescriptor: makeDescriptor(),
    workspaceRoot: ROOT,
    ...overrides,
  };
}

function renderHook(
  deps: PhpContextualMemberDefinitionNavigationDependencies,
) {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: { api: PhpContextualMemberDefinitionNavigation | null } = {
    api: null,
  };

  function Harness({
    dependencies,
  }: {
    dependencies: PhpContextualMemberDefinitionNavigationDependencies;
  }) {
    captured.api = usePhpContextualMemberDefinitionNavigation(dependencies);
    return null;
  }

  act(() => {
    root.render(<Harness dependencies={deps} />);
  });

  const api = (): PhpContextualMemberDefinitionNavigation => {
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

describe("usePhpContextualMemberDefinitionNavigation", () => {
  it("resolves parent static method calls before reporting no typed target", async () => {
    const openDirectPhpMethodTarget = vi.fn(async () => true);
    const deps = makeDeps({ openDirectPhpMethodTarget });
    const harness = renderHook(deps);

    const handled = await harness.api().goToPhpStaticMethodCallDefinition({
      className: "parent",
      kind: "staticMethodCall",
      methodName: "boot",
    });

    expect(handled).toBe(true);
    expect(openDirectPhpMethodTarget).toHaveBeenCalledWith(
      "App\\ParentClass",
      "boot",
    );
    expect(deps.setMessage).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("falls back from missing class constants to the receiver class", async () => {
    const openPhpClassTarget = vi.fn(async () => true);
    const deps = makeDeps({
      openPhpClassTarget,
      resolvePhpClassReference: vi.fn(() => "App\\Status"),
      resolvePhpClassSourcePaths: vi.fn(async () => []),
    });
    const harness = renderHook(deps);

    const handled = await harness.api().goToPhpClassConstantDefinition({
      className: "Status",
      constantName: "ACTIVE",
      kind: "classConstant",
    });

    expect(handled).toBe(true);
    expect(openPhpClassTarget).toHaveBeenCalledWith("App\\Status", "Status");

    harness.unmount();
  });

  it("drops relation navigation when the active workspace changes mid-resolution", async () => {
    const ownerType = deferred<string | null>();
    const currentWorkspaceRootRef = { current: ROOT };
    const openDirectPhpMethodTarget = vi.fn(async () => true);
    const deps = makeDeps({
      activeDocument: {
        content: "<?php Comment::with('author');",
        language: "php",
        name: "CommentRepository.php",
        path: `${ROOT}/app/CommentRepository.php`,
        savedContent: "",
      },
      currentWorkspaceRootRef,
      openDirectPhpMethodTarget,
      resolvePhpLaravelRelationPathOwnerType: vi.fn(() => ownerType.promise),
    });
    const harness = renderHook(deps);
    const navigationPromise = harness.api().goToPhpLaravelRelationStringDefinition({
      className: "App\\Models\\Comment",
      kind: "laravelRelationString",
      methodName: "with",
      receiverExpression: null,
      relationName: "author",
    });

    currentWorkspaceRootRef.current = OTHER_ROOT;
    ownerType.resolve("App\\Models\\Comment");

    await expect(navigationPromise).resolves.toBe(false);
    expect(openDirectPhpMethodTarget).not.toHaveBeenCalled();

    harness.unmount();
  });
});
