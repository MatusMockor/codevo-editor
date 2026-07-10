// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { phpLaravelFrameworkProvider } from "../domain/phpFrameworkProviders";
import type { PhpMethodCompletion } from "../domain/phpMethodCompletions";
import { createPhpFrameworkIntelligence } from "./phpFrameworkIntelligence";
import { createPhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import {
  usePhpMethodCompletionProvider,
  type PhpMethodCompletionProvider,
  type PhpMethodCompletionProviderDependencies,
} from "./usePhpMethodCompletionProvider";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const ROOT = "/workspace";
const OTHER_ROOT = "/other";
const LARAVEL_RUNTIME = createPhpFrameworkRuntimeContext(
  createPhpFrameworkIntelligence({
    matchedProviderIds: ["laravel"],
    profile: "laravel",
    providers: [phpLaravelFrameworkProvider],
  }),
);
const GENERIC_RUNTIME = createPhpFrameworkRuntimeContext(
  createPhpFrameworkIntelligence({
    matchedProviderIds: [],
    profile: "generic",
    providers: [],
  }),
);

function positionAfter(source: string, needle: string) {
  const offset = source.indexOf(needle);

  if (offset < 0) {
    throw new Error(`Missing test needle: ${needle}`);
  }

  return positionAt(source, offset + needle.length);
}

function positionAt(source: string, offset: number) {
  const before = source.slice(0, offset);
  const lines = before.split("\n");
  const lastLine = lines[lines.length - 1] ?? "";

  return {
    column: lastLine.length + 1,
    lineNumber: lines.length,
  };
}

function method(
  name: string,
  overrides: Partial<PhpMethodCompletion> = {},
): PhpMethodCompletion {
  return {
    declaringClassName: "App\\Http\\Controllers\\ReportController",
    name,
    parameters: "",
    returnType: "void",
    visibility: "public",
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });

  return { promise, resolve };
}

function makeDeps(
  overrides: Partial<PhpMethodCompletionProviderDependencies> = {},
): PhpMethodCompletionProviderDependencies {
  return {
    activeDocument: {
      content: "<?php",
      language: "php",
      name: "routes.php",
      path: `${ROOT}/routes/web.php`,
      savedContent: "",
    },
    activePhpFrameworkProviders: [],
    collectAuthGuardTargets: vi.fn(async () => []),
    collectBroadcastConnectionTargets: vi.fn(async () => []),
    collectCacheStoreTargets: vi.fn(async () => []),
    collectConfigTargets: vi.fn(async () => []),
    collectDatabaseConnectionTargets: vi.fn(async () => []),
    collectEnvTargets: vi.fn(async () => []),
    collectGateAbilityTargets: vi.fn(async () => []),
    collectLogChannelTargets: vi.fn(async () => []),
    collectMailMailerTargets: vi.fn(async () => []),
    collectMiddlewareAliasTargets: vi.fn(async () => []),
    collectNamedRouteTargets: vi.fn(async () => []),
    collectPasswordBrokerTargets: vi.fn(async () => []),
    collectPhpLaravelRelationCompletionsForClass: vi.fn(async () => []),
    collectPhpMethodsForClass: vi.fn(async () => []),
    collectQueueConnectionTargets: vi.fn(async () => []),
    collectRedisConnectionTargets: vi.fn(async () => []),
    collectStorageDiskTargets: vi.fn(async () => []),
    collectTranslationTargets: vi.fn(async () => []),
    collectViewTargets: vi.fn(async () => []),
    currentWorkspaceRootRef: { current: ROOT },
    ensurePhpFrameworkSourceCollectionsLoaded: vi.fn(async () => undefined),
    frameworkRuntime: LARAVEL_RUNTIME,
    isLaravelFrameworkActive: true,
    resolvePhpClassReference: vi.fn(
      (_source: string, className: string) => `App\\Http\\Controllers\\${className}`,
    ),
    resolvePhpEloquentBuilderModelType: vi.fn(async () => null),
    resolvePhpExpressionType: vi.fn(async () => null),
    resolvePhpLaravelRelationPathOwnerType: vi.fn(async () => null),
    resolvePhpReceiverMethodCompletions: vi.fn(async () => []),
    resolvePhpStaticMethodCompletions: vi.fn(async () => []),
    workspaceRoot: ROOT,
    ...overrides,
  };
}

function renderHook(deps: PhpMethodCompletionProviderDependencies) {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: { api: PhpMethodCompletionProvider | null } = {
    api: null,
  };

  function Harness({
    dependencies,
  }: {
    dependencies: PhpMethodCompletionProviderDependencies;
  }) {
    captured.api = usePhpMethodCompletionProvider(dependencies);
    return null;
  }

  act(() => {
    root.render(<Harness dependencies={deps} />);
  });

  const api = (): PhpMethodCompletionProvider => {
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

describe("usePhpMethodCompletionProvider", () => {
  it("returns public instance route-action methods before generic member completions", async () => {
    const source = `<?php
use App\\Http\\Controllers\\ReportController;

Route::get('/reports', [ReportController::class, 'in']);
`;
    const collectPhpMethodsForClass = vi.fn(async () => [
      method("inspect"),
      method("index"),
      method("internal", { visibility: "protected" }),
      method("instance", { isStatic: true }),
      method("items", { kind: "property" }),
    ]);
    const resolvePhpReceiverMethodCompletions = vi.fn(async () => [
      method("ignoredReceiver"),
    ]);
    const deps = makeDeps({
      collectPhpMethodsForClass,
      resolvePhpReceiverMethodCompletions,
    });
    const harness = renderHook(deps);

    const completions = await harness
      .api()
      .providePhpMethodCompletions(source, positionAfter(source, "'in"));

    expect(completions.map((completion) => completion.name)).toEqual([
      "index",
      "inspect",
    ]);
    expect(collectPhpMethodsForClass).toHaveBeenCalledWith(
      "App\\Http\\Controllers\\ReportController",
    );
    expect(resolvePhpReceiverMethodCompletions).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("returns Laravel relation string completions from the resolved owner type", async () => {
    const source = `<?php
use App\\Models\\Comment;

Comment::with('par')->first();
`;
    const collectPhpLaravelRelationCompletionsForClass = vi.fn(async () => [
      method("children"),
      method("parent"),
      method("participants"),
    ]);
    const resolvePhpClassReference = vi.fn(
      (_source: string, className: string) => `App\\Models\\${className}`,
    );
    const resolvePhpLaravelRelationPathOwnerType = vi.fn(
      async (className: string) => className,
    );
    const deps = makeDeps({
      collectPhpLaravelRelationCompletionsForClass,
      resolvePhpClassReference,
      resolvePhpLaravelRelationPathOwnerType,
    });
    const harness = renderHook(deps);

    const completions = await harness
      .api()
      .providePhpMethodCompletions(source, positionAfter(source, "with('par"));

    expect(completions.map((completion) => completion.name)).toEqual([
      "parent",
      "participants",
    ]);
    expect(resolvePhpClassReference).toHaveBeenCalledWith(source, "Comment");
    expect(resolvePhpLaravelRelationPathOwnerType).toHaveBeenCalledWith(
      "App\\Models\\Comment",
      [],
    );
    expect(collectPhpLaravelRelationCompletionsForClass).toHaveBeenCalledWith(
      "App\\Models\\Comment",
    );

    harness.unmount();
  });

  it("drops receiver completions that resolve after the active workspace changed", async () => {
    const source = `<?php
$comment->loa`;
    const pendingCompletions = deferred<PhpMethodCompletion[]>();
    const currentWorkspaceRootRef = { current: ROOT };
    const deps = makeDeps({
      currentWorkspaceRootRef,
      resolvePhpExpressionType: vi.fn(async () => "App\\Models\\Comment"),
      resolvePhpReceiverMethodCompletions: vi.fn(
        async () => pendingCompletions.promise,
      ),
    });
    const harness = renderHook(deps);
    const completionRequest = harness
      .api()
      .providePhpMethodCompletions(source, positionAfter(source, "$comment->loa"));

    currentWorkspaceRootRef.current = OTHER_ROOT;
    pendingCompletions.resolve([method("load")]);

    await expect(completionRequest).resolves.toEqual([]);

    harness.unmount();
  });

  it("warms framework source collections for member access without blocking completions", async () => {
    const source = `<?php
$comment->lo`;
    const ensurePhpFrameworkSourceCollectionsLoaded = vi.fn(
      async () => undefined,
    );
    const deps = makeDeps({
      ensurePhpFrameworkSourceCollectionsLoaded,
      resolvePhpReceiverMethodCompletions: vi.fn(async () => [
        method("load"),
      ]),
    });
    const harness = renderHook(deps);

    const completions = await harness
      .api()
      .providePhpMethodCompletions(source, positionAfter(source, "$comment->lo"));

    expect(completions.map((completion) => completion.name)).toEqual(["load"]);
    expect(ensurePhpFrameworkSourceCollectionsLoaded).toHaveBeenCalledWith(ROOT);

    harness.unmount();
  });

  it("does not use legacy Laravel magic when runtime is generic", async () => {
    const source = `<?php
$comment->lo`;
    const ensurePhpFrameworkSourceCollectionsLoaded = vi.fn(
      async () => undefined,
    );
    const deps = makeDeps({
      ensurePhpFrameworkSourceCollectionsLoaded,
      frameworkRuntime: GENERIC_RUNTIME,
      isLaravelFrameworkActive: true,
      resolvePhpReceiverMethodCompletions: vi.fn(async () => [
        method("load"),
      ]),
    });
    const harness = renderHook(deps);

    const completions = await harness
      .api()
      .providePhpMethodCompletions(source, positionAfter(source, "$comment->lo"));

    expect(completions.map((completion) => completion.name)).toEqual(["load"]);
    expect(ensurePhpFrameworkSourceCollectionsLoaded).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("keeps scoped Laravel completions for legacy callers without runtime context", async () => {
    const source = "<?php\nreturn Auth::guard('ad');";
    const deps = makeDeps({
      activePhpFrameworkProviders: [phpLaravelFrameworkProvider],
      collectAuthGuardTargets: vi.fn(async () => [
        {
          guardName: "admin",
          key: "auth.guards.admin",
          path: `${ROOT}/config/auth.php`,
          position: { column: 12, lineNumber: 4 },
          relativePath: "config/auth.php",
        },
      ]),
      frameworkRuntime: undefined,
      isLaravelFrameworkActive: true,
    });
    const harness = renderHook(deps);

    const completions = await harness
      .api()
      .providePhpMethodCompletions(source, positionAfter(source, "ad"));

    expect(completions.map((completion) => completion.name)).toEqual(["admin"]);
    expect(deps.collectAuthGuardTargets).toHaveBeenCalled();

    harness.unmount();
  });

  it("keeps Laravel method completion adapters for boolean-only legacy callers", async () => {
    const routeSource = `<?php
use App\\Http\\Controllers\\ReportController;

Route::get('/reports', [ReportController::class, 'in']);
`;
    const relationSource = `<?php
use App\\Models\\Comment;

Comment::with('par')->first();
`;
    const accessSource = "<?php\n$comment->lo";
    const ensurePhpFrameworkSourceCollectionsLoaded = vi.fn(
      async () => undefined,
    );
    const deps = makeDeps({
      activePhpFrameworkProviders: [],
      collectPhpLaravelRelationCompletionsForClass: vi.fn(async () => [
        method("parent"),
      ]),
      collectPhpMethodsForClass: vi.fn(async () => [method("index")]),
      ensurePhpFrameworkSourceCollectionsLoaded,
      frameworkRuntime: undefined,
      isLaravelFrameworkActive: true,
      resolvePhpLaravelRelationPathOwnerType: vi.fn(
        async (className: string) => className,
      ),
      resolvePhpReceiverMethodCompletions: vi.fn(async () => [method("load")]),
    });
    const harness = renderHook(deps);

    const routeCompletions = await harness
      .api()
      .providePhpMethodCompletions(
        routeSource,
        positionAfter(routeSource, "'in"),
      );
    const relationCompletions = await harness
      .api()
      .providePhpMethodCompletions(
        relationSource,
        positionAfter(relationSource, "with('par"),
      );
    const accessCompletions = await harness
      .api()
      .providePhpMethodCompletions(
        accessSource,
        positionAfter(accessSource, "$comment->lo"),
      );

    expect(routeCompletions.map(({ name }) => name)).toEqual(["index"]);
    expect(relationCompletions.map(({ name }) => name)).toEqual(["parent"]);
    expect(accessCompletions.map(({ name }) => name)).toEqual(["load"]);
    expect(ensurePhpFrameworkSourceCollectionsLoaded).toHaveBeenCalledWith(
      ROOT,
    );

    harness.unmount();
  });
});
