import { phpLaravelFrameworkProvider } from "../domain/phpFrameworkLaravelProvider";
import { phpNetteFrameworkProvider } from "../domain/phpFrameworkNetteProvider";
// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

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
const NETTE_RUNTIME = createPhpFrameworkRuntimeContext(
  createPhpFrameworkIntelligence({
    matchedProviderIds: ["nette"],
    profile: "nette",
    providers: [phpNetteFrameworkProvider],
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

function completion(fields: Record<string, unknown>) {
  return expect.objectContaining(fields);
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
    collectPhpFrameworkRelationCompletionsForClass: vi.fn(async () => []),
    collectPhpMethodsForClass: vi.fn(async () => []),
    collectQueueConnectionTargets: vi.fn(async () => []),
    collectRedisConnectionTargets: vi.fn(async () => []),
    collectStorageDiskTargets: vi.fn(async () => []),
    collectTranslationTargets: vi.fn(async () => []),
    collectViewTargets: vi.fn(async () => []),
    currentWorkspaceRootRef: { current: ROOT },
    ensurePhpFrameworkSourceCollectionsLoaded: vi.fn(async () => undefined),
    frameworkRuntime: LARAVEL_RUNTIME,
    joinWorkspacePath: (rootPath, relativePath) =>
      `${rootPath}/${relativePath}`,
    projectSymbolSearch: {
      searchProjectSymbols: vi.fn(async () => []),
    },
    readNavigationFileContent: vi.fn(async () => ""),
    relativeWorkspacePath: (workspaceRoot, path) =>
      path.startsWith(`${workspaceRoot}/`)
        ? path.slice(workspaceRoot.length + 1)
        : path,
    resolvePhpClassReference: vi.fn(
      (_source: string, className: string) =>
        `App\\Http\\Controllers\\${className}`,
    ),
    resolvePhpFrameworkBuilderModelType: vi.fn(async () => null),
    resolvePhpExpressionType: vi.fn(async () => null),
    resolvePhpFrameworkRelationPathOwnerType: vi.fn(async () => null),
    resolvePhpReceiverMethodCompletions: vi.fn(async () => []),
    resolvePhpStaticMethodCompletions: vi.fn(async () => []),
    resolvePhpTraitHostClassNames: vi.fn(async () => []),
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
    const collectPhpFrameworkRelationCompletionsForClass = vi.fn(async () => [
      method("children"),
      method("parent"),
      method("participants"),
    ]);
    const resolvePhpClassReference = vi.fn(
      (_source: string, className: string) => `App\\Models\\${className}`,
    );
    const resolvePhpFrameworkRelationPathOwnerType = vi.fn(
      async (className: string) => className,
    );
    const deps = makeDeps({
      collectPhpFrameworkRelationCompletionsForClass,
      resolvePhpClassReference,
      resolvePhpFrameworkRelationPathOwnerType,
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
    expect(resolvePhpFrameworkRelationPathOwnerType).toHaveBeenCalledWith(
      "App\\Models\\Comment",
      [],
    );
    expect(collectPhpFrameworkRelationCompletionsForClass).toHaveBeenCalledWith(
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
      .providePhpMethodCompletions(
        source,
        positionAfter(source, "$comment->loa"),
      );

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
      resolvePhpReceiverMethodCompletions: vi.fn(async () => [method("load")]),
    });
    const harness = renderHook(deps);

    const completions = await harness
      .api()
      .providePhpMethodCompletions(
        source,
        positionAfter(source, "$comment->lo"),
      );

    expect(completions.map((completion) => completion.name)).toEqual(["load"]);
    expect(ensurePhpFrameworkSourceCollectionsLoaded).toHaveBeenCalledWith(
      ROOT,
    );

    harness.unmount();
  });

  it("uses runtime Laravel state for the Laravel gate", async () => {
    const source = `<?php
$comment->lo`;
    const ensurePhpFrameworkSourceCollectionsLoaded = vi.fn(
      async () => undefined,
    );
    const deps = makeDeps({
      ensurePhpFrameworkSourceCollectionsLoaded,
      frameworkRuntime: GENERIC_RUNTIME,
      resolvePhpReceiverMethodCompletions: vi.fn(async () => [method("load")]),
    });
    const harness = renderHook(deps);

    const completions = await harness
      .api()
      .providePhpMethodCompletions(
        source,
        positionAfter(source, "$comment->lo"),
      );

    expect(completions.map((completion) => completion.name)).toEqual(["load"]);
    expect(ensurePhpFrameworkSourceCollectionsLoaded).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("provides scoped Laravel completions under the Laravel runtime", async () => {
    const source = "<?php\nreturn Auth::guard('ad');";
    const deps = makeDeps({
      collectAuthGuardTargets: vi.fn(async () => [
        {
          guardName: "admin",
          key: "auth.guards.admin",
          path: `${ROOT}/config/auth.php`,
          position: { column: 12, lineNumber: 4 },
          relativePath: "config/auth.php",
        },
      ]),
      frameworkRuntime: LARAVEL_RUNTIME,
    });
    const harness = renderHook(deps);

    const completions = await harness
      .api()
      .providePhpMethodCompletions(source, positionAfter(source, "ad"));

    expect(completions.map((completion) => completion.name)).toEqual(["admin"]);
    expect(deps.collectAuthGuardTargets).toHaveBeenCalled();

    harness.unmount();
  });

  it("keeps Laravel method completion adapters active under the Laravel runtime", async () => {
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
      collectPhpFrameworkRelationCompletionsForClass: vi.fn(async () => [
        method("parent"),
      ]),
      collectPhpMethodsForClass: vi.fn(async () => [method("index")]),
      ensurePhpFrameworkSourceCollectionsLoaded,
      frameworkRuntime: LARAVEL_RUNTIME,
      resolvePhpFrameworkRelationPathOwnerType: vi.fn(
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

  it("provides Nette redrawControl snippet completions from colocated templates", async () => {
    const source = "<?php\n$this->redrawControl('mail');";
    const readNavigationFileContent = vi.fn(async () =>
      ["{snippet mailLogslisting}", "{/snippet}", "{snippet sidebar}"].join(
        "\n",
      ),
    );
    const deps = makeDeps({
      activeDocument: {
        content: source,
        language: "php",
        name: "MailLogs.php",
        path: `${ROOT}/app/modules/mailerModule/Components/MailLogs/MailLogs.php`,
        savedContent: source,
      },
      frameworkRuntime: NETTE_RUNTIME,
      readNavigationFileContent,
    });
    const harness = renderHook(deps);

    const completions = await harness
      .api()
      .providePhpMethodCompletions(source, positionAfter(source, "ma"));

    expect(completions).toEqual([
      completion({
        declaringClassName:
          "app/modules/mailerModule/Components/MailLogs/mail_logs.latte",
        insertText: "mailLogslisting",
        kind: "nette.ajax-snippet",
        name: "mailLogslisting",
        parameters: "",
        replaceEnd: source.indexOf("'", source.indexOf("mail")),
        replaceStart: source.indexOf("mail"),
        returnType: null,
      }),
    ]);
    expect(readNavigationFileContent).toHaveBeenCalledWith(
      `${ROOT}/app/modules/mailerModule/Components/MailLogs/mail_logs.latte`,
    );

    harness.unmount();
  });

  it("does not collect Nette snippets for dynamic redrawControl arguments", async () => {
    const source = "<?php\n$this->redrawControl($name);";
    const readNavigationFileContent = vi.fn(async () => "");
    const deps = makeDeps({
      frameworkRuntime: NETTE_RUNTIME,
      readNavigationFileContent,
    });
    const harness = renderHook(deps);

    await expect(
      harness
        .api()
        .providePhpMethodCompletions(source, positionAfter(source, "name")),
    ).resolves.toEqual([]);
    expect(readNavigationFileContent).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("does not collect Nette snippets when Nette is inactive", async () => {
    const source = "<?php\n$this->redrawControl('mai');";
    const readNavigationFileContent = vi.fn(async () => "");
    const deps = makeDeps({
      frameworkRuntime: GENERIC_RUNTIME,
      readNavigationFileContent,
    });
    const harness = renderHook(deps);

    await expect(
      harness
        .api()
        .providePhpMethodCompletions(source, positionAfter(source, "mai")),
    ).resolves.toEqual([]);
    expect(readNavigationFileContent).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("does not collect Nette snippets when the Nette profile lacks the provider boundary", async () => {
    const source = "<?php\n$this->redrawControl('mai');";
    const readNavigationFileContent = vi.fn(async () => "");
    const deps = makeDeps({
      frameworkRuntime: {
        ...NETTE_RUNTIME,
        supports: (capability) =>
          capability === "netteRedrawControlSnippetCompletions"
            ? false
            : NETTE_RUNTIME.supports(capability),
      },
      readNavigationFileContent,
    });
    const harness = renderHook(deps);

    await expect(
      harness
        .api()
        .providePhpMethodCompletions(source, positionAfter(source, "mai")),
    ).resolves.toEqual([]);
    expect(readNavigationFileContent).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("does not collect Nette snippets for Laravel runtimes with redrawControl source", async () => {
    const source = "<?php\n$this->redrawControl('mai');";
    const readNavigationFileContent = vi.fn(async () => "");
    const deps = makeDeps({
      frameworkRuntime: LARAVEL_RUNTIME,
      readNavigationFileContent,
    });
    const harness = renderHook(deps);

    await expect(
      harness
        .api()
        .providePhpMethodCompletions(source, positionAfter(source, "mai")),
    ).resolves.toEqual([]);
    expect(readNavigationFileContent).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("keeps enum case completions for static access", async () => {
    const source = "<?php\nStatus::";
    const deps = makeDeps({
      resolvePhpStaticMethodCompletions: vi.fn(async () => [
        method("Active", {
          isEnumCase: true,
          isStatic: true,
          kind: "property",
          returnType: "Status",
        }),
        method("label"),
      ]),
    });
    const harness = renderHook(deps);

    const completions = await harness
      .api()
      .providePhpMethodCompletions(source, positionAfter(source, "Status::"));

    expect(completions.map((completion) => completion.name)).toEqual([
      "Active",
      "label",
    ]);

    harness.unmount();
  });

  it("drops enum case completions for instance member access", async () => {
    const source = "<?php\n$status->";
    const deps = makeDeps({
      resolvePhpReceiverMethodCompletions: vi.fn(async () => [
        method("Active", {
          isEnumCase: true,
          isStatic: true,
          kind: "property",
          returnType: "Status",
        }),
        method("label"),
      ]),
    });
    const harness = renderHook(deps);

    const completions = await harness
      .api()
      .providePhpMethodCompletions(source, positionAfter(source, "$status->"));

    expect(completions.map((completion) => completion.name)).toEqual(["label"]);

    harness.unmount();
  });

  it("offers constructor named argument completions for project classes", async () => {
    const source = "<?php\n$user = new User(";
    const collectPhpMethodsForClass = vi.fn(async () => [
      method("__construct", {
        parameters: "string $name, int $age, ?string $email = null",
      }),
      method("save"),
    ]);
    const resolvePhpClassReference = vi.fn(
      (_source: string, className: string) => `App\\Models\\${className}`,
    );
    const deps = makeDeps({
      collectPhpMethodsForClass,
      resolvePhpClassReference,
    });
    const harness = renderHook(deps);

    const completions = await harness
      .api()
      .providePhpMethodCompletions(source, positionAfter(source, "new User("));

    expect(completions.map((completion) => completion.name)).toEqual([
      "name:",
      "age:",
      "email:",
    ]);
    expect(completions[0]).toEqual(
      completion({
        insertText: "name: ",
        kind: "property",
        returnType: "string",
      }),
    );
    expect(resolvePhpClassReference).toHaveBeenCalledWith(source, "User");
    expect(collectPhpMethodsForClass).toHaveBeenCalledWith("App\\Models\\User");

    harness.unmount();
  });

  it("skips used named arguments and consumed positional parameters", async () => {
    const source = "<?php\n$user = new User('Ada', email: 'a@b.c', ";
    const deps = makeDeps({
      collectPhpMethodsForClass: vi.fn(async () => [
        method("__construct", {
          parameters: "string $name, int $age, ?string $email = null",
        }),
      ]),
      resolvePhpClassReference: vi.fn(
        (_source: string, className: string) => `App\\Models\\${className}`,
      ),
    });
    const harness = renderHook(deps);

    const completions = await harness
      .api()
      .providePhpMethodCompletions(
        source,
        positionAfter(source, "email: 'a@b.c', "),
      );

    expect(completions.map((completion) => completion.name)).toEqual(["age:"]);

    harness.unmount();
  });

  it("offers named arguments for static method calls", async () => {
    const source = "<?php\nUser::create(";
    const resolvePhpStaticMethodCompletions = vi.fn(async () => [
      method("create", { parameters: "array $attributes = []" }),
    ]);
    const deps = makeDeps({ resolvePhpStaticMethodCompletions });
    const harness = renderHook(deps);

    const completions = await harness
      .api()
      .providePhpMethodCompletions(source, positionAfter(source, "create("));

    expect(completions.map((completion) => completion.name)).toEqual([
      "attributes:",
    ]);
    expect(resolvePhpStaticMethodCompletions).toHaveBeenCalledWith(
      source,
      "User",
    );

    harness.unmount();
  });

  it("drops named argument results when the active project changes", async () => {
    const source = "<?php\nUser::create(";
    const pendingMembers = deferred<PhpMethodCompletion[]>();
    const currentWorkspaceRootRef = { current: ROOT };
    const harness = renderHook(
      makeDeps({
        currentWorkspaceRootRef,
        resolvePhpStaticMethodCompletions: vi.fn(
          async () => pendingMembers.promise,
        ),
      }),
    );

    const completionRequest = harness
      .api()
      .providePhpMethodCompletions(source, positionAfter(source, "create("));
    currentWorkspaceRootRef.current = OTHER_ROOT;
    pendingMembers.resolve([
      method("create", { parameters: "array $attributes = []" }),
    ]);

    await expect(completionRequest).resolves.toEqual([]);
    harness.unmount();
  });

  it("offers named arguments for resolvable receiver method calls", async () => {
    const source = "<?php\n$this->send($to, su";
    const resolvePhpReceiverMethodCompletions = vi.fn(async () => [
      method("send", {
        parameters: "string $to, string $subject, string $body = ''",
      }),
    ]);
    const deps = makeDeps({ resolvePhpReceiverMethodCompletions });
    const harness = renderHook(deps);

    const completions = await harness
      .api()
      .providePhpMethodCompletions(source, positionAfter(source, "su"));

    expect(completions.map((completion) => completion.name)).toEqual([
      "subject:",
    ]);
    expect(resolvePhpReceiverMethodCompletions).toHaveBeenCalledWith(
      source,
      positionAfter(source, "su"),
      "$this",
      null,
      expect.any(Function),
    );

    harness.unmount();
  });

  it("offers named arguments for a same-file function", async () => {
    const source = [
      "<?php",
      "function render(string $view, array $data = []): string { return ''; }",
      "render(da",
    ].join("\n");
    const harness = renderHook(makeDeps());

    const completions = await harness
      .api()
      .providePhpMethodCompletions(source, positionAfter(source, "render(da"));

    expect(completions.map((completion) => completion.name)).toEqual(["data:"]);
    harness.unmount();
  });

  it("offers named arguments for a statically assigned local callable", async () => {
    const source = [
      "<?php",
      "$format = fn(string $value, int $precision = 2) => $value;",
      "$format(pre",
    ].join("\n");
    const harness = renderHook(makeDeps());

    const completions = await harness
      .api()
      .providePhpMethodCompletions(
        source,
        positionAfter(source, "$format(pre"),
      );

    expect(completions.map((completion) => completion.name)).toEqual([
      "precision:",
    ]);
    harness.unmount();
  });

  it("resolves named arguments for an imported cross-file function alias", async () => {
    const source = [
      "<?php",
      "namespace App\\Reports;",
      "use function Vendor\\Formatting\\render_report as output;",
      "output(da",
    ].join("\n");
    const targetPath = `${ROOT}/vendor/formatting/functions.php`;
    const searchProjectSymbols = vi.fn(async () => [
      {
        column: 1,
        containerName: null,
        fullyQualifiedName: "Vendor\\Formatting\\render_report",
        kind: "function" as const,
        lineNumber: 3,
        name: "render_report",
        path: targetPath,
        relativePath: "vendor/formatting/functions.php",
      },
    ]);
    const readNavigationFileContent = vi.fn(async () =>
      [
        "<?php",
        "namespace Vendor\\Formatting;",
        "function render_report(string $view, array $data = []): string { return ''; }",
      ].join("\n"),
    );
    const harness = renderHook(
      makeDeps({
        projectSymbolSearch: { searchProjectSymbols },
        readNavigationFileContent,
      }),
    );

    const completions = await harness
      .api()
      .providePhpMethodCompletions(source, positionAfter(source, "output(da"));

    expect(completions.map((completion) => completion.name)).toEqual(["data:"]);
    expect(searchProjectSymbols).toHaveBeenCalledWith(
      ROOT,
      "render_report",
      50,
    );
    expect(readNavigationFileContent).toHaveBeenCalledWith(targetPath);
    harness.unmount();
  });

  it("drops cross-file function results when the project changes during symbol search", async () => {
    const source = "<?php\nuse function Vendor\\render;\nrender(vi";
    const pendingSymbols =
      deferred<
        Awaited<
          ReturnType<
            PhpMethodCompletionProviderDependencies["projectSymbolSearch"]["searchProjectSymbols"]
          >
        >
      >();
    const currentWorkspaceRootRef = { current: ROOT };
    const readNavigationFileContent = vi.fn(
      async () => "<?php function render(string $view): void {}",
    );
    const harness = renderHook(
      makeDeps({
        currentWorkspaceRootRef,
        projectSymbolSearch: {
          searchProjectSymbols: vi.fn(() => pendingSymbols.promise),
        },
        readNavigationFileContent,
      }),
    );

    const request = harness
      .api()
      .providePhpMethodCompletions(source, positionAfter(source, "render(vi"));
    currentWorkspaceRootRef.current = OTHER_ROOT;
    pendingSymbols.resolve([
      {
        column: 1,
        containerName: null,
        fullyQualifiedName: "Vendor\\render",
        kind: "function",
        lineNumber: 1,
        name: "render",
        path: `${ROOT}/vendor/functions.php`,
        relativePath: "vendor/functions.php",
      },
    ]);

    await expect(request).resolves.toEqual([]);
    expect(readNavigationFileContent).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("drops cross-file function results when the project changes during file read", async () => {
    const source = "<?php\nuse function Vendor\\render;\nrender(vi";
    const pendingSource = deferred<string>();
    const currentWorkspaceRootRef = { current: ROOT };
    const harness = renderHook(
      makeDeps({
        currentWorkspaceRootRef,
        projectSymbolSearch: {
          searchProjectSymbols: vi.fn(async () => [
            {
              column: 1,
              containerName: null,
              fullyQualifiedName: "Vendor\\render",
              kind: "function" as const,
              lineNumber: 1,
              name: "render",
              path: `${ROOT}/vendor/functions.php`,
              relativePath: "vendor/functions.php",
            },
          ]),
        },
        readNavigationFileContent: vi.fn(() => pendingSource.promise),
      }),
    );

    const request = harness
      .api()
      .providePhpMethodCompletions(source, positionAfter(source, "render(vi"));
    await Promise.resolve();
    currentWorkspaceRootRef.current = OTHER_ROOT;
    pendingSource.resolve(
      "<?php namespace Vendor; function render(string $view): void {}",
    );

    await expect(request).resolves.toEqual([]);
    harness.unmount();
  });

  it("does not offer named arguments when the project supports PHP 7", async () => {
    const source =
      "<?php\nfunction render(string $view): string { return ''; }\nrender(";
    const harness = renderHook(
      makeDeps({
        phpVersionConstraint: "^7.4 || ^8.2",
      }),
    );

    await expect(
      harness
        .api()
        .providePhpMethodCompletions(source, positionAfter(source, "render(")),
    ).resolves.toEqual([]);
    harness.unmount();
  });

  it("offers named arguments for $this method calls inside traits", async () => {
    const source = `<?php

trait DispatchesMail
{
    public function boot(): void
    {
        $this->dispatch($to, su
    }

    public function dispatch(string $to, string $subject): void
    {
    }
}
`;
    const resolvePhpReceiverMethodCompletions = vi.fn(
      async (
        _source: string,
        _position: unknown,
        _receiverExpression: string,
        traitThisContext?: unknown,
      ) =>
        traitThisContext
          ? [
              method("dispatch", {
                declaringClassName: "DispatchesMail",
                parameters: "string $to, string $subject",
              }),
            ]
          : [],
    );
    const deps = makeDeps({ resolvePhpReceiverMethodCompletions });
    const harness = renderHook(deps);

    const completions = await harness
      .api()
      .providePhpMethodCompletions(source, positionAfter(source, "($to, su"));

    expect(completions.map((completion) => completion.name)).toEqual([
      "subject:",
    ]);
    expect(resolvePhpReceiverMethodCompletions).toHaveBeenCalledWith(
      source,
      positionAfter(source, "($to, su"),
      "$this",
      expect.objectContaining({ declaringClassName: "DispatchesMail" }),
      expect.any(Function),
    );

    harness.unmount();
  });

  it("does not offer named arguments inside declarations", async () => {
    const source = "<?php\nclass A { public function handle(";
    const deps = makeDeps({
      collectPhpMethodsForClass: vi.fn(async () => [
        method("handle", { parameters: "string $signal" }),
      ]),
    });
    const harness = renderHook(deps);

    await expect(
      harness
        .api()
        .providePhpMethodCompletions(source, positionAfter(source, "handle(")),
    ).resolves.toEqual([]);

    harness.unmount();
  });
});
