import { phpLaravelFrameworkProvider } from "../domain/phpFrameworkLaravelProvider";
import { describe, expect, it, vi } from "vitest";
import {
  type PhpFrameworkProvider,
} from "../domain/phpFrameworkProviders";
import {
  resolvePhpFrameworkLiteralCompletions,
  type PhpFrameworkLiteralCompletionDependencies,
} from "./phpFrameworkLiteralCompletions";

const PLAIN_COMPLETION_BEHAVIOR = {
  insertTextMode: "plain",
  triggerParameterHints: false,
} as const;

function dependencies(
  overrides: Partial<PhpFrameworkLiteralCompletionDependencies> = {},
): PhpFrameworkLiteralCompletionDependencies {
  return {
    collectConfigTargets: vi.fn(async () => []),
    collectEnvTargets: vi.fn(async () => []),
    collectNamedRouteTargets: vi.fn(async () => []),
    collectTranslationTargets: vi.fn(async () => []),
    collectViewTargets: vi.fn(async () => []),
    isRequestStillCurrent: vi.fn(() => true),
    ...overrides,
  };
}

describe("resolvePhpFrameworkLiteralCompletions", () => {
  it("returns null when no active provider matches a framework literal", async () => {
    const deps = dependencies({
      collectConfigTargets: vi.fn(async () => [
        {
          key: "app.name",
          relativePath: "config/app.php",
        },
      ]),
    });
    const source = "<?php\nreturn config('app.');";

    await expect(
      resolvePhpFrameworkLiteralCompletions(
        {
          activeDocument: {
            content: source,
            path: "/workspace/app/Http/Controllers/HomeController.php",
          },
          position: positionAfter(source, "app."),
          providers: [],
          source,
        },
        deps,
      ),
    ).resolves.toBeNull();

    expect(deps.collectConfigTargets).not.toHaveBeenCalled();
  });

  it("does not synthesize Laravel insert text for custom providers without formatter hooks", async () => {
    const customProvider: PhpFrameworkProvider = {
      config: {
        referenceAt: () => ({
          call: "custom",
          key: "app.",
          position: { column: 22, lineNumber: 2 },
          prefix: "app.",
        }),
      },
      id: "custom",
    };
    const deps = dependencies({
      collectConfigTargets: vi.fn(async () => [
        {
          key: "app.name",
          relativePath: "config/app.php",
        },
      ]),
    });
    const source = "<?php\nreturn custom_config('app.');";

    await expect(
      resolvePhpFrameworkLiteralCompletions(
        {
          activeDocument: {
            content: source,
            path: "/workspace/app/Http/Controllers/HomeController.php",
          },
          position: positionAfter(source, "app."),
          providers: [customProvider],
          source,
        },
        deps,
      ),
    ).resolves.toEqual([]);

    expect(deps.collectConfigTargets).not.toHaveBeenCalled();
  });

  it("lets custom providers own literal completion formatting with their hook", async () => {
    const customProvider: PhpFrameworkProvider = {
      config: {
        completionInsertText: ({ key, prefix }) => key.slice(prefix.length),
        referenceAt: () => ({
          call: "custom",
          key: "app.",
          position: { column: 22, lineNumber: 2 },
          prefix: "app.",
        }),
      },
      id: "custom",
    };
    const deps = dependencies({
      collectConfigTargets: vi.fn(async () => [
        {
          key: "app.name",
          relativePath: "config/app.php",
        },
      ]),
    });
    const source = "<?php\nreturn custom_config('app.');";

    await expect(
      resolvePhpFrameworkLiteralCompletions(
        {
          activeDocument: {
            content: source,
            path: "/workspace/app/Http/Controllers/HomeController.php",
          },
          position: positionAfter(source, "app."),
          providers: [customProvider],
          source,
        },
        deps,
      ),
    ).resolves.toEqual([
      {
        declaringClassName: "config/app.php",
        insertText: "name",
        kind: "config",
        name: "app.name",
        parameters: "",
        returnType: null,
      },
    ]);
  });

  it("completes named routes case-insensitively and inserts the suffix for a dotted prefix", async () => {
    const deps = dependencies({
      collectNamedRouteTargets: vi.fn(async () => [
        {
          name: "Admin.Dashboard",
          path: "/workspace/routes/web.php",
          relativePath: "routes/web.php",
        },
        {
          name: "api.users.index",
          path: "/workspace/routes/api.php",
          relativePath: "routes/api.php",
        },
      ]),
    });
    const source = "<?php\nreturn route('admin.');";

    await expect(
      resolvePhpFrameworkLiteralCompletions(
        {
          activeDocument: {
            content: source,
            path: "/workspace/app/Http/Controllers/HomeController.php",
          },
          position: positionAfter(source, "admin."),
          providers: [phpLaravelFrameworkProvider],
          source,
        },
        deps,
      ),
    ).resolves.toEqual([
      {
        completionBehavior: PLAIN_COMPLETION_BEHAVIOR,
        declaringClassName: "routes/web.php",
        detail: "Laravel route - routes/web.php",
        documentation: "Laravel named route\n\nAdmin.Dashboard",
        insertText: "Dashboard",
        kind: "route",
        name: "Admin.Dashboard",
        parameters: "",
        returnType: null,
      },
    ]);

    expect(deps.collectNamedRouteTargets).toHaveBeenCalledWith(
      source,
      "/workspace/app/Http/Controllers/HomeController.php",
    );
  });

  it("completes config keys with existing insert-text formatting", async () => {
    const deps = dependencies({
      collectConfigTargets: vi.fn(async () => [
        {
          key: "app.name",
          relativePath: "config/app.php",
        },
      ]),
    });
    const source = "<?php\nreturn config('app.');";

    await expect(
      resolvePhpFrameworkLiteralCompletions(
        {
          activeDocument: {
            content: source,
            path: "/workspace/app/Http/Controllers/HomeController.php",
          },
          position: positionAfter(source, "app."),
          providers: [phpLaravelFrameworkProvider],
          source,
        },
        deps,
      ),
    ).resolves.toEqual([
      {
        completionBehavior: PLAIN_COMPLETION_BEHAVIOR,
        declaringClassName: "config/app.php",
        detail: "Laravel config - config/app.php",
        documentation: "Laravel config\n\napp.name",
        insertText: "name",
        kind: "config",
        name: "app.name",
        parameters: "",
        returnType: null,
      },
    ]);
  });

  it("completes translation keys with PHP lang-file insert-text formatting", async () => {
    const deps = dependencies({
      collectTranslationTargets: vi.fn(async () => [
        {
          key: "messages.welcome",
          relativePath: "lang/en/messages.php",
        },
      ]),
    });
    const source = "<?php\nreturn __('messages.');";

    await expect(
      resolvePhpFrameworkLiteralCompletions(
        {
          activeDocument: {
            content: source,
            path: "/workspace/app/Http/Controllers/HomeController.php",
          },
          position: positionAfter(source, "messages."),
          providers: [phpLaravelFrameworkProvider],
          source,
        },
        deps,
      ),
    ).resolves.toEqual([
      {
        completionBehavior: PLAIN_COMPLETION_BEHAVIOR,
        declaringClassName: "lang/en/messages.php",
        detail: "Laravel translation - lang/en/messages.php",
        documentation: "Laravel translation\n\nmessages.welcome",
        insertText: "welcome",
        kind: "translation",
        name: "messages.welcome",
        parameters: "",
        returnType: null,
      },
    ]);
  });

  it("completes env names only when Laravel is active", async () => {
    const deps = dependencies({
      collectEnvTargets: vi.fn(async () => [
        {
          name: "APP_NAME",
          relativePath: ".env",
        },
      ]),
    });
    const source = "<?php\nreturn env('APP_');";

    await expect(
      resolvePhpFrameworkLiteralCompletions(
        {
          activeDocument: {
            content: source,
            path: "/workspace/app/Http/Controllers/HomeController.php",
          },
          position: positionAfter(source, "APP_"),
          providers: [phpLaravelFrameworkProvider],
          source,
        },
        deps,
      ),
    ).resolves.toEqual([
      {
        completionBehavior: PLAIN_COMPLETION_BEHAVIOR,
        declaringClassName: ".env",
        detail: "Laravel env - .env",
        documentation: "Laravel env\n\nAPP_NAME",
        insertText: "APP_NAME",
        kind: "env",
        name: "APP_NAME",
        parameters: "",
        returnType: null,
      },
    ]);

    await expect(
      resolvePhpFrameworkLiteralCompletions(
        {
          activeDocument: {
            content: source,
            path: "/workspace/app/Http/Controllers/HomeController.php",
          },
          position: positionAfter(source, "APP_"),
          providers: [],
          source,
        },
        deps,
      ),
    ).resolves.toBeNull();
  });

  it("completes view names with existing insert-text formatting", async () => {
    const deps = dependencies({
      collectViewTargets: vi.fn(async () => [
        {
          name: "admin.dashboard",
          relativePath: "resources/views/admin/dashboard.blade.php",
        },
      ]),
    });
    const source = "<?php\nreturn view('admin.d');";

    await expect(
      resolvePhpFrameworkLiteralCompletions(
        {
          activeDocument: {
            content: source,
            path: "/workspace/app/Http/Controllers/HomeController.php",
          },
          position: positionAfter(source, "admin.d"),
          providers: [phpLaravelFrameworkProvider],
          source,
        },
        deps,
      ),
    ).resolves.toEqual([
      {
        completionBehavior: PLAIN_COMPLETION_BEHAVIOR,
        declaringClassName: "resources/views/admin/dashboard.blade.php",
        detail: "Laravel view - resources/views/admin/dashboard.blade.php",
        documentation: "Laravel view\n\nadmin.dashboard",
        insertText: "dashboard",
        kind: "view",
        name: "admin.dashboard",
        parameters: "",
        returnType: null,
      },
    ]);
  });
});

function positionAfter(source: string, token: string) {
  const offset = source.indexOf(token);

  if (offset < 0) {
    throw new Error(`Token not found: ${token}`);
  }

  let lineNumber = 1;
  let column = 1;

  for (let index = 0; index < offset + token.length; index += 1) {
    if (source[index] === "\n") {
      lineNumber += 1;
      column = 1;
      continue;
    }

    column += 1;
  }

  return { column, lineNumber };
}
