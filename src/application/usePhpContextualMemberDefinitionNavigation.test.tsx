// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceDescriptor } from "../domain/workspace";
import { createPhpFrameworkIntelligence } from "./phpFrameworkIntelligence";
import { createPhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import {
  usePhpContextualMemberDefinitionNavigation,
  type PhpContextualMemberDefinitionNavigation,
  type PhpContextualMemberDefinitionNavigationDependencies,
} from "./usePhpContextualMemberDefinitionNavigation";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const ROOT = "/workspace";
const OTHER_ROOT = "/other";
const GENERIC_RUNTIME = createPhpFrameworkRuntimeContext(
  createPhpFrameworkIntelligence({
    matchedProviderIds: [],
    profile: "generic",
    providers: [],
  }),
);

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
    rerender: (
      dependencies: PhpContextualMemberDefinitionNavigationDependencies,
    ) => {
      act(() => {
        root.render(<Harness dependencies={dependencies} />);
      });
    },
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

  it("uses runtime Laravel state over the legacy boolean for relation navigation", async () => {
    const resolvePhpLaravelRelationPathOwnerType = vi.fn(async () =>
      "App\\Models\\Comment",
    );
    const deps = makeDeps({
      frameworkRuntime: GENERIC_RUNTIME,
      isLaravelFrameworkActive: true,
      resolvePhpLaravelRelationPathOwnerType,
    });
    const harness = renderHook(deps);

    const handled = await harness.api().goToPhpLaravelRelationStringDefinition({
      className: "App\\Models\\Comment",
      kind: "laravelRelationString",
      methodName: "with",
      receiverExpression: null,
      relationName: "author",
    });

    expect(handled).toBe(false);
    expect(resolvePhpLaravelRelationPathOwnerType).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("uses a replaced builder model resolver after rerendering relation navigation", async () => {
    const initialResolver = vi.fn(async () => "App\\Models\\InitialPost");
    const replacementResolver = vi.fn(async () =>
      "App\\Models\\ReplacementPost",
    );
    const openDirectPhpMethodTarget = vi.fn(async () => true);
    const resolvePhpLaravelRelationPathOwnerType = vi.fn(
      async (ownerType: string) => ownerType,
    );
    const deps = makeDeps({
      openDirectPhpMethodTarget,
      resolvePhpEloquentBuilderModelType: initialResolver,
      resolvePhpLaravelRelationPathOwnerType,
    });
    const harness = renderHook(deps);

    harness.rerender({
      ...deps,
      resolvePhpEloquentBuilderModelType: replacementResolver,
    });

    const handled = await harness.api().goToPhpLaravelRelationStringDefinition({
      className: null,
      kind: "laravelRelationString",
      methodName: "with",
      receiverExpression: "$post",
      relationName: "comments",
    });

    expect(handled).toBe(true);
    expect(initialResolver).not.toHaveBeenCalled();
    expect(replacementResolver).toHaveBeenCalledWith(
      deps.activeDocument?.content,
      deps.activeEditorPositionRef.current,
      "$post",
    );
    expect(resolvePhpLaravelRelationPathOwnerType).toHaveBeenCalledWith(
      "App\\Models\\ReplacementPost",
      [],
    );
    expect(openDirectPhpMethodTarget).toHaveBeenCalledWith(
      "App\\Models\\ReplacementPost",
      "comments",
    );

    harness.unmount();
  });

  it("keeps Laravel method-call decisions inactive for a generic runtime", async () => {
    const openPhpLaravelDynamicWhereTarget = vi.fn(async () => true);
    const openPhpMethodHintTarget = vi.fn(async () => true);
    const resolvePhpEloquentBuilderModelType = vi.fn(async () =>
      "App\\Models\\Post",
    );
    const deps = makeDeps({
      frameworkRuntime: GENERIC_RUNTIME,
      isLaravelFrameworkActive: true,
      openPhpLaravelDynamicWhereTarget,
      openPhpMethodHintTarget,
      resolvePhpEloquentBuilderModelType,
      resolvePhpExpressionType: vi.fn(async () => "Illuminate\\Http\\Request"),
    });
    const harness = renderHook(deps);

    const handled = await harness.api().goToPhpMethodCallDefinition({
      kind: "methodCall",
      methodName: "input",
      receiverExpression: "$request",
      variableName: "request",
    });

    expect(handled).toBe(false);
    expect(openPhpMethodHintTarget).not.toHaveBeenCalled();
    expect(resolvePhpEloquentBuilderModelType).not.toHaveBeenCalled();
    expect(openPhpLaravelDynamicWhereTarget).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("keeps static Laravel magic navigation inactive for a generic runtime", async () => {
    const openDirectPhpMethodTarget = vi.fn(async () => false);
    const openPhpLaravelDynamicWhereTarget = vi.fn(async () => true);
    const deps = makeDeps({
      frameworkRuntime: GENERIC_RUNTIME,
      isLaravelFrameworkActive: true,
      openDirectPhpMethodTarget,
      openPhpLaravelDynamicWhereTarget,
      resolvePhpClassReference: vi.fn(() => "App\\Models\\Post"),
    });
    const harness = renderHook(deps);

    const handled = await harness.api().goToPhpStaticMethodCallDefinition({
      className: "Post",
      kind: "staticMethodCall",
      methodName: "where",
    });

    expect(handled).toBe(false);
    expect(openDirectPhpMethodTarget).toHaveBeenCalledTimes(1);
    expect(openDirectPhpMethodTarget).toHaveBeenCalledWith(
      "App\\Models\\Post",
      "where",
    );
    expect(openPhpLaravelDynamicWhereTarget).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("preserves instance navigation precedence", async () => {
    const calls: string[] = [];
    const deps = makeDeps({
      openDirectPhpMethodTarget: vi.fn(async (className, methodName) => {
        calls.push(`direct:${className}:${methodName}`);
        return false;
      }),
      openPhpLaravelDynamicWhereTarget: vi.fn(async (className, methodName) => {
        calls.push(`dynamic:${className}:${methodName}`);
        return true;
      }),
      openPhpMethodHintTarget: vi.fn(async () => {
        calls.push("hint");
        return false;
      }),
      resolvePhpEloquentBuilderModelType: vi.fn(async () =>
        "App\\Models\\Post",
      ),
      resolvePhpExpressionType: vi.fn(async () =>
        "App\\Http\\Requests\\StorePostRequest",
      ),
    });
    const harness = renderHook(deps);

    const handled = await harness.api().goToPhpMethodCallDefinition({
      kind: "methodCall",
      methodName: "input",
      receiverExpression: "$request",
      variableName: "request",
    });

    expect(handled).toBe(false);
    expect(calls).toEqual(["hint"]);

    harness.unmount();
  });

  it("tries instance direct, builder scope, then dynamic where targets", async () => {
    const calls: string[] = [];
    const deps = makeDeps({
      openDirectPhpMethodTarget: vi.fn(async (className, methodName) => {
        calls.push(`direct:${className}:${methodName}`);
        return false;
      }),
      openPhpLaravelDynamicWhereTarget: vi.fn(async (className, methodName) => {
        calls.push(`dynamic:${className}:${methodName}`);
        return true;
      }),
      resolvePhpEloquentBuilderModelType: vi.fn(async () =>
        "App\\Models\\Post",
      ),
      resolvePhpExpressionType: vi.fn(async () => "App\\Models\\Post"),
    });
    const harness = renderHook(deps);

    const handled = await harness.api().goToPhpMethodCallDefinition({
      kind: "methodCall",
      methodName: "published",
      receiverExpression: "$post",
      variableName: "post",
    });

    expect(handled).toBe(true);
    expect(calls).toEqual([
      "direct:App\\Models\\Post:published",
      "direct:App\\Models\\Post:scopePublished",
      "dynamic:App\\Models\\Post:published",
    ]);
    expect(deps.setMessage).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("preserves static navigation precedence through the Builder fallback", async () => {
    const calls: string[] = [];
    const openDirectPhpMethodTarget = vi.fn(
      async (className: string, methodName: string) => {
        calls.push(`direct:${className}:${methodName}`);
        return className === "Illuminate\\Database\\Eloquent\\Builder";
      },
    );
    const openPhpLaravelDynamicWhereTarget = vi.fn(
      async (className: string, methodName: string) => {
        calls.push(`dynamic:${className}:${methodName}`);
        return false;
      },
    );
    const deps = makeDeps({
      openDirectPhpMethodTarget,
      openPhpLaravelDynamicWhereTarget,
      resolvePhpClassReference: vi.fn(() => "App\\Models\\Post"),
    });
    const harness = renderHook(deps);

    const handled = await harness.api().goToPhpStaticMethodCallDefinition({
      className: "Post",
      kind: "staticMethodCall",
      methodName: "where",
    });

    expect(handled).toBe(true);
    expect(calls).toEqual([
      "direct:App\\Models\\Post:where",
      "direct:App\\Models\\Post:scopeWhere",
      "dynamic:App\\Models\\Post:where",
      "direct:Illuminate\\Database\\Eloquent\\Builder:where",
    ]);
    expect(deps.setMessage).not.toHaveBeenCalled();

    harness.unmount();
  });
});
