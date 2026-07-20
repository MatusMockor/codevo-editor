import { describe, expect, it, vi } from "vitest";
import type { PhpMethodCompletion } from "../domain/phpMethodCompletions";
import {
  createPhpFrameworkMethodCompletionProviderAdapters,
  type PhpFrameworkMethodCompletionProviderAdapterDependencies,
} from "./phpFrameworkMethodCompletionProviderAdapters";

function method(
  name: string,
  overrides: Partial<PhpMethodCompletion> = {},
): PhpMethodCompletion {
  return {
    declaringClassName: "App\\Http\\Controllers\\PostController",
    name,
    parameters: "",
    returnType: "void",
    visibility: "public",
    ...overrides,
  };
}

function makeDeps(
  overrides: Partial<PhpFrameworkMethodCompletionProviderAdapterDependencies> = {},
): PhpFrameworkMethodCompletionProviderAdapterDependencies {
  return {
    collectPhpFrameworkRelationCompletionsForClass: vi.fn(async () => []),
    collectPhpMethodsForClass: vi.fn(async () => []),
    collectNetteRedrawControlSnippetTargets: vi.fn(async () => []),
    ensurePhpFrameworkSourceCollectionsLoaded: vi.fn(async () => undefined),
    frameworkRuntime: {
      hasProvider: () => true,
      supports: (capability) => capability === "eloquentModelSemantics",
    },
    resolvePhpClassReference: vi.fn(() => null),
    resolvePhpFrameworkBuilderModelType: vi.fn(async () => null),
    resolvePhpExpressionType: vi.fn(async () => null),
    resolvePhpFrameworkRelationPathOwnerType: vi.fn(async () => null),
    ...overrides,
  };
}

function positionAfter(source: string, needle: string) {
  const offset = source.indexOf(needle);

  if (offset < 0) {
    throw new Error(`Missing test needle: ${needle}`);
  }

  const prefixSource = source.slice(0, offset + needle.length);
  const prefixLines = prefixSource.split("\n");

  return {
    column: (prefixLines[prefixLines.length - 1]?.length ?? 0) + 1,
    lineNumber: prefixLines.length,
  };
}

describe("phpFrameworkMethodCompletionProviderAdapters", () => {
  it.each([
    { activeProviderId: null, label: "generic" },
    { activeProviderId: "laravel", label: "stale Laravel provider-id" },
  ])("keeps $label runtimes inert without Eloquent semantics", async ({
    activeProviderId,
  }) => {
    const ensurePhpFrameworkSourceCollectionsLoaded = vi.fn(
      async () => undefined,
    );
    const frameworkRuntime = {
      hasProvider: vi.fn(
        (providerId: string) => providerId === activeProviderId,
      ),
      supports: vi.fn(() => false),
    };
    const adapter = createPhpFrameworkMethodCompletionProviderAdapters(
      makeDeps({
        ensurePhpFrameworkSourceCollectionsLoaded,
        frameworkRuntime,
      }),
    );
    const request = {
      isRequestStillCurrent: () => true,
      position: { column: 1, lineNumber: 1 },
      source: "<?php",
    };

    await expect(
      adapter.literalStringCompletions({
        ...request,
        activeDocumentPath: "/workspace/routes/web.php",
      }),
    ).resolves.toBeNull();
    await expect(adapter.routeActionCompletions(request)).resolves.toBeNull();
    await expect(adapter.relationStringCompletions(request)).resolves.toBeNull();
    adapter.ensureSourceCollectionsLoadedForAccess({
      accessContext: {
        prefix: "",
        receiverExpression: "$post",
        variableName: "$post",
      },
      rootPath: "/workspace",
      staticAccessContext: null,
    });

    expect(frameworkRuntime.hasProvider).not.toHaveBeenCalled();
    expect(frameworkRuntime.supports).toHaveBeenCalledWith(
      "eloquentModelSemantics",
    );
    expect(frameworkRuntime.supports).toHaveBeenCalledWith(
      "netteRedrawControlSnippetCompletions",
    );
    expect(ensurePhpFrameworkSourceCollectionsLoaded).not.toHaveBeenCalled();
  });

  it("selects the Laravel adapter by Eloquent model semantics capability", async () => {
    const frameworkRuntime = {
      hasProvider: vi.fn(() => false),
      supports: vi.fn(
        (capability: string) => capability === "eloquentModelSemantics",
      ),
    };
    const adapter = createPhpFrameworkMethodCompletionProviderAdapters(
      makeDeps({ frameworkRuntime }),
    );
    const source = "<?php\nRoute::get('/posts', [Missing::class, 'in']);";
    const prefixOffset = source.indexOf("'in") + "'in".length;
    const prefixSource = source.slice(0, prefixOffset);
    const prefixLines = prefixSource.split("\n");

    await expect(
      adapter.routeActionCompletions({
        isRequestStillCurrent: () => true,
        position: {
          column: (prefixLines[prefixLines.length - 1]?.length ?? 0) + 1,
          lineNumber: prefixLines.length,
        },
        source,
      }),
    ).resolves.toEqual([]);
    expect(frameworkRuntime.hasProvider).not.toHaveBeenCalled();
    expect(frameworkRuntime.supports).toHaveBeenCalledWith(
      "eloquentModelSemantics",
    );
  });

  it("keeps Laravel and Nette method completion adapters active for mixed providers", async () => {
    const collectNetteRedrawControlSnippetTargets = vi.fn(async () => [
      {
        name: "mailLogslisting",
        relativePath:
          "app/modules/mailerModule/Components/MailLogs/mail_logs.latte",
      },
    ]);
    const collectPhpMethodsForClass = vi.fn(async () => [
      method("index"),
      method("show"),
    ]);
    const frameworkRuntime = {
      hasProvider: vi.fn((providerId: string) => providerId === "laravel"),
      supports: vi.fn(
        (capability: string) =>
          capability === "eloquentModelSemantics" ||
          capability === "netteRedrawControlSnippetCompletions",
      ),
    };
    const adapter = createPhpFrameworkMethodCompletionProviderAdapters(
      makeDeps({
        collectNetteRedrawControlSnippetTargets,
        collectPhpMethodsForClass,
        frameworkRuntime,
        resolvePhpClassReference: vi.fn(
          () => "App\\Http\\Controllers\\PostController",
        ),
      }),
    );
    const redrawSource = "<?php\n$this->redrawControl('mai');";
    const routeSource =
      "<?php\nRoute::get('/posts', [PostController::class, 'in']);";

    const redrawCompletions = await adapter.literalStringCompletions({
      activeDocumentPath: "/workspace/app/Presenters/MailerPresenter.php",
      isRequestStillCurrent: () => true,
      position: positionAfter(redrawSource, "mai"),
      source: redrawSource,
    });
    const routeCompletions = await adapter.routeActionCompletions({
      isRequestStillCurrent: () => true,
      position: positionAfter(routeSource, "'in"),
      source: routeSource,
    });

    expect(redrawCompletions?.map(({ name }) => name)).toEqual([
      "mailLogslisting",
    ]);
    expect(routeCompletions?.map(({ name }) => name)).toEqual(["index"]);
    expect(collectNetteRedrawControlSnippetTargets).toHaveBeenCalledWith(
      "/workspace/app/Presenters/MailerPresenter.php",
    );
    expect(collectPhpMethodsForClass).toHaveBeenCalledWith(
      "App\\Http\\Controllers\\PostController",
    );
    expect(frameworkRuntime.hasProvider).not.toHaveBeenCalled();
    expect(frameworkRuntime.supports).toHaveBeenCalledWith(
      "eloquentModelSemantics",
    );
    expect(frameworkRuntime.supports).toHaveBeenCalledWith(
      "netteRedrawControlSnippetCompletions",
    );
  });

  it("does not activate Nette literal completions for a non-Nette provider", async () => {
    const collectNetteRedrawControlSnippetTargets = vi.fn(async () => [
      {
        name: "mailLogslisting",
        relativePath:
          "app/modules/mailerModule/Components/MailLogs/mail_logs.latte",
      },
    ]);
    const frameworkRuntime = {
      hasProvider: vi.fn((providerId: string) => providerId === "laravel"),
      supports: vi.fn(() => false),
    };
    const adapter = createPhpFrameworkMethodCompletionProviderAdapters(
      makeDeps({
        collectNetteRedrawControlSnippetTargets,
        frameworkRuntime,
      }),
    );
    const source = "<?php\n$this->redrawControl('mai');";
    const prefixSource = source.slice(0, source.indexOf("mai") + "mai".length);
    const prefixLines = prefixSource.split("\n");

    await expect(
      adapter.literalStringCompletions({
        activeDocumentPath: "/workspace/app/Presenters/MailerPresenter.php",
        isRequestStillCurrent: () => true,
        position: {
          column: (prefixLines[prefixLines.length - 1]?.length ?? 0) + 1,
          lineNumber: prefixLines.length,
        },
        source,
      }),
    ).resolves.toBeNull();

    expect(frameworkRuntime.hasProvider).not.toHaveBeenCalled();
    expect(frameworkRuntime.supports).toHaveBeenCalledWith(
      "eloquentModelSemantics",
    );
    expect(frameworkRuntime.supports).toHaveBeenCalledWith(
      "netteRedrawControlSnippetCompletions",
    );
    expect(collectNetteRedrawControlSnippetTargets).not.toHaveBeenCalled();
  });

  it("skips Nette method completions safely when capability extras are absent", async () => {
    const frameworkRuntime = {
      hasProvider: vi.fn((providerId: string) => providerId === "nette"),
      supports: vi.fn(
        (capability: string) =>
          capability === "netteRedrawControlSnippetCompletions",
      ),
    };
    const adapter = createPhpFrameworkMethodCompletionProviderAdapters(
      makeDeps({
        collectNetteRedrawControlSnippetTargets: undefined,
        frameworkRuntime,
      }),
    );
    const source = "<?php\n$this->redrawControl('mai');";

    await expect(
      adapter.literalStringCompletions({
        activeDocumentPath: "/workspace/app/Presenters/MailerPresenter.php",
        isRequestStillCurrent: () => true,
        position: positionAfter(source, "mai"),
        source,
      }),
    ).resolves.toBeNull();

    expect(frameworkRuntime.hasProvider).not.toHaveBeenCalled();
    expect(frameworkRuntime.supports).toHaveBeenCalledWith(
      "netteRedrawControlSnippetCompletions",
    );
  });

  it("keeps stale Nette provider-id runtimes inert without the redraw capability", async () => {
    const collectNetteRedrawControlSnippetTargets = vi.fn(async () => [
      {
        name: "mailLogslisting",
        relativePath:
          "app/modules/mailerModule/Components/MailLogs/mail_logs.latte",
      },
    ]);
    const frameworkRuntime = {
      hasProvider: vi.fn((providerId: string) => providerId === "nette"),
    };
    const adapter = createPhpFrameworkMethodCompletionProviderAdapters(
      makeDeps({
        collectNetteRedrawControlSnippetTargets,
        frameworkRuntime,
      }),
    );
    const source = "<?php\n$this->redrawControl('mai');";

    await expect(
      adapter.literalStringCompletions({
        activeDocumentPath: "/workspace/app/Presenters/MailerPresenter.php",
        isRequestStillCurrent: () => true,
        position: positionAfter(source, "mai"),
        source,
      }),
    ).resolves.toBeNull();

    expect(collectNetteRedrawControlSnippetTargets).not.toHaveBeenCalled();
  });
});
