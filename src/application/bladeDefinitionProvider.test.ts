import { describe, expect, it, vi } from "vitest";
import { phpLaravelFrameworkProvider } from "../domain/phpFrameworkProviders";
import {
  provideBladeDefinition,
  type BladeDefinitionProviderDependencies,
} from "./bladeDefinitionProvider";
import { createPhpFrameworkIntelligence } from "./phpFrameworkIntelligence";
import { createPhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";

const ROOT = "/workspace";
const BLADE_PATH = `${ROOT}/resources/views/comments/show.blade.php`;
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

function position(lineNumber = 1, column = 1) {
  return { column, lineNumber };
}

function makeDeps(
  overrides: Partial<BladeDefinitionProviderDependencies> = {},
): BladeDefinitionProviderDependencies {
  return {
    activeDocument: { content: "", path: BLADE_PATH },
    collectPhpLaravelNamedRouteTargets: vi.fn(async () => []),
    currentWorkspaceRootRef: { current: ROOT },
    findPhpLaravelConfigTarget: vi.fn(async () => null),
    findPhpLaravelTranslationTarget: vi.fn(async () => null),
    findPhpLaravelViewTarget: vi.fn(async () => null),
    frameworkRuntime: LARAVEL_RUNTIME,
    openDirectPhpMethodTarget: vi.fn(async () => false),
    openDirectPhpPropertyTarget: vi.fn(async () => false),
    openNavigationTarget: vi.fn(async () => true),
    openPhpLaravelModelAttributeTarget: vi.fn(async () => false),
    readNavigationFileContent: vi.fn(async () => ""),
    relativeWorkspacePath: (root, path) =>
      path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path,
    resolveBladeViewVariableTypeForView: vi.fn(async () => null),
    workspaceRoot: ROOT,
    ...overrides,
  };
}

function offsetOf(source: string, needle: string): number {
  const offset = source.indexOf(needle);

  if (offset < 0) {
    throw new Error(`Missing test needle: ${needle}`);
  }

  return offset + Math.floor(needle.length / 2);
}

describe("provideBladeDefinition", () => {
  it("returns false without a workspace root", async () => {
    const openNavigationTarget = vi.fn(async () => true);
    const readNavigationFileContent = vi.fn(async () => "");

    await expect(
      provideBladeDefinition(
        "@include('partials.alert')",
        12,
        makeDeps({
          openNavigationTarget,
          readNavigationFileContent,
          workspaceRoot: null,
        }),
      ),
    ).resolves.toBe(false);
    expect(readNavigationFileContent).not.toHaveBeenCalled();
    expect(openNavigationTarget).not.toHaveBeenCalled();
  });

  it("returns false inside Blade comments", async () => {
    const readNavigationFileContent = vi.fn(async () => "");
    const source = "{{-- @include('partials.alert') --}}";

    await expect(
      provideBladeDefinition(
        source,
        offsetOf(source, "partials.alert"),
        makeDeps({ readNavigationFileContent }),
      ),
    ).resolves.toBe(false);
    expect(readNavigationFileContent).not.toHaveBeenCalled();
  });

  it("navigates view directives to the referenced blade file", async () => {
    const openNavigationTarget = vi.fn(async () => true);
    const source = "@include('partials.alert')";

    await expect(
      provideBladeDefinition(
        source,
        offsetOf(source, "partials.alert"),
        makeDeps({ openNavigationTarget }),
      ),
    ).resolves.toBe(true);
    expect(openNavigationTarget).toHaveBeenCalledWith(
      `${ROOT}/resources/views/partials/alert.blade.php`,
      { column: 1, lineNumber: 1 },
      "partials.alert",
    );
  });

  it("tries component class targets before anonymous blade component views", async () => {
    const openNavigationTarget = vi.fn(async () => true);
    const readNavigationFileContent = vi.fn(async () => "");
    const source = "<x-alert />";

    await expect(
      provideBladeDefinition(
        source,
        offsetOf(source, "alert"),
        makeDeps({ openNavigationTarget, readNavigationFileContent }),
      ),
    ).resolves.toBe(true);
    expect(openNavigationTarget).toHaveBeenCalledWith(
      `${ROOT}/app/View/Components/Alert.php`,
      { column: 1, lineNumber: 1 },
      "alert",
    );
  });

  it("falls through to anonymous component views when the class target is missing", async () => {
    const openNavigationTarget = vi.fn(async () => true);
    const readNavigationFileContent = vi.fn(async (path: string) => {
      if (path.endsWith("/app/View/Components/Alert.php")) {
        throw new Error("missing");
      }

      return "";
    });
    const source = "<x-alert />";

    await expect(
      provideBladeDefinition(
        source,
        offsetOf(source, "alert"),
        makeDeps({ openNavigationTarget, readNavigationFileContent }),
      ),
    ).resolves.toBe(true);
    expect(openNavigationTarget).toHaveBeenCalledWith(
      `${ROOT}/resources/views/components/alert.blade.php`,
      { column: 1, lineNumber: 1 },
      "alert",
    );
  });

  it("drops stale view navigation after an async read resolves under another root", async () => {
    const currentWorkspaceRootRef = { current: ROOT };
    const openNavigationTarget = vi.fn(async () => true);
    const readNavigationFileContent = vi.fn(async () => {
      currentWorkspaceRootRef.current = "/other";

      return "";
    });
    const source = "@component('partials.card')";

    await expect(
      provideBladeDefinition(
        source,
        offsetOf(source, "partials.card"),
        makeDeps({
          currentWorkspaceRootRef,
          openNavigationTarget,
          readNavigationFileContent,
        }),
      ),
    ).resolves.toBe(false);
    expect(openNavigationTarget).not.toHaveBeenCalled();
  });

  it("gates Laravel helper navigation behind the active framework", async () => {
    const collectPhpLaravelNamedRouteTargets = vi.fn(async () => []);
    const source = "{{ route('dashboard') }}";

    await expect(
      provideBladeDefinition(
        source,
        offsetOf(source, "dashboard"),
        makeDeps({
          collectPhpLaravelNamedRouteTargets,
          frameworkRuntime: GENERIC_RUNTIME,
        }),
      ),
    ).resolves.toBe(false);
    expect(collectPhpLaravelNamedRouteTargets).not.toHaveBeenCalled();
  });

  it("navigates Laravel view helper literals through view targets", async () => {
    const openNavigationTarget = vi.fn(async () => true);
    const findPhpLaravelViewTarget = vi.fn(async () => ({
      name: "comments.show",
      path: `${ROOT}/resources/views/comments/show.blade.php`,
      position: position(3, 1),
      relativePath: "resources/views/comments/show.blade.php",
    }));
    const source = "{{ view('comments.show') }}";

    await expect(
      provideBladeDefinition(
        source,
        offsetOf(source, "comments.show"),
        makeDeps({ findPhpLaravelViewTarget, openNavigationTarget }),
      ),
    ).resolves.toBe(true);
    expect(openNavigationTarget).toHaveBeenCalledWith(
      `${ROOT}/resources/views/comments/show.blade.php`,
      position(3, 1),
      "comments.show",
    );
  });

  it("navigates route helper literals using the active document", async () => {
    const openNavigationTarget = vi.fn(async () => true);
    const collectPhpLaravelNamedRouteTargets = vi.fn(async () => [
      {
        name: "Comments.Show",
        path: `${ROOT}/routes/web.php`,
        position: position(12, 5),
        relativePath: "routes/web.php",
      },
    ]);
    const activeDocument = { content: "{{ route('comments.show') }}", path: BLADE_PATH };

    await expect(
      provideBladeDefinition(
        activeDocument.content,
        offsetOf(activeDocument.content, "comments.show"),
        makeDeps({
          activeDocument,
          collectPhpLaravelNamedRouteTargets,
          openNavigationTarget,
        }),
      ),
    ).resolves.toBe(true);
    expect(collectPhpLaravelNamedRouteTargets).toHaveBeenCalledWith(
      activeDocument.content,
      activeDocument.path,
    );
    expect(openNavigationTarget).toHaveBeenCalledWith(
      `${ROOT}/routes/web.php`,
      position(12, 5),
      "Comments.Show",
    );
  });

  it("returns false for route helper literals when no active document exists", async () => {
    const collectPhpLaravelNamedRouteTargets = vi.fn(async () => []);
    const source = "{{ route('comments.show') }}";

    await expect(
      provideBladeDefinition(
        source,
        offsetOf(source, "comments.show"),
        makeDeps({
          activeDocument: null,
          collectPhpLaravelNamedRouteTargets,
        }),
      ),
    ).resolves.toBe(false);
    expect(collectPhpLaravelNamedRouteTargets).not.toHaveBeenCalled();
  });

  it("navigates config and translation helper literals through Laravel targets", async () => {
    const openNavigationTarget = vi.fn(async () => true);
    const findPhpLaravelConfigTarget = vi.fn(async () => ({
      key: "app.name",
      path: `${ROOT}/config/app.php`,
      position: position(7, 10),
      relativePath: "config/app.php",
    }));
    const findPhpLaravelTranslationTarget = vi.fn(async () => ({
      key: "messages.welcome",
      path: `${ROOT}/lang/en/messages.php`,
      position: position(2, 5),
      relativePath: "lang/en/messages.php",
    }));
    const deps = makeDeps({
      findPhpLaravelConfigTarget,
      findPhpLaravelTranslationTarget,
      openNavigationTarget,
    });

    const configSource = "{{ config('app.name') }}";
    const transSource = "{{ __('messages.welcome') }}";

    await expect(
      provideBladeDefinition(
        configSource,
        offsetOf(configSource, "app.name"),
        deps,
      ),
    ).resolves.toBe(true);
    await expect(
      provideBladeDefinition(
        transSource,
        offsetOf(transSource, "messages.welcome"),
        deps,
      ),
    ).resolves.toBe(true);
    expect(openNavigationTarget).toHaveBeenCalledWith(
      `${ROOT}/config/app.php`,
      position(7, 10),
      "app.name",
    );
    expect(openNavigationTarget).toHaveBeenCalledWith(
      `${ROOT}/lang/en/messages.php`,
      position(2, 5),
      "messages.welcome",
    );
  });

  it("navigates typed Blade view-data member methods", async () => {
    const openDirectPhpMethodTarget = vi.fn(async () => true);
    const resolveBladeViewVariableTypeForView = vi.fn(
      async () => "App\\Models\\Comment",
    );
    const source = "{{ $comment->author() }}";

    await expect(
      provideBladeDefinition(
        source,
        offsetOf(source, "author"),
        makeDeps({
          openDirectPhpMethodTarget,
          resolveBladeViewVariableTypeForView,
        }),
      ),
    ).resolves.toBe(true);
    expect(resolveBladeViewVariableTypeForView).toHaveBeenCalledWith(
      "comments.show",
      "$comment",
    );
    expect(openDirectPhpMethodTarget).toHaveBeenCalledWith(
      "App\\Models\\Comment",
      "author",
    );
  });

  it("falls back from missing property to Laravel model attribute then direct property", async () => {
    const openDirectPhpPropertyTarget = vi.fn(async () => true);
    const openPhpLaravelModelAttributeTarget = vi.fn(async () => false);
    const source = "{{ $comment->title }}";

    await expect(
      provideBladeDefinition(
        source,
        offsetOf(source, "title"),
        makeDeps({
          openDirectPhpPropertyTarget,
          openPhpLaravelModelAttributeTarget,
          resolveBladeViewVariableTypeForView: vi.fn(
            async () => "App\\Models\\Comment",
          ),
        }),
      ),
    ).resolves.toBe(true);
    expect(openPhpLaravelModelAttributeTarget).toHaveBeenCalledWith(
      "App\\Models\\Comment",
      "title",
    );
    expect(openDirectPhpPropertyTarget).toHaveBeenCalledWith(
      "App\\Models\\Comment",
      "title",
    );
  });

  it("drops stale typed member navigation after resolving the view variable type", async () => {
    const currentWorkspaceRootRef = { current: ROOT };
    const openDirectPhpMethodTarget = vi.fn(async () => true);
    const resolveBladeViewVariableTypeForView = vi.fn(async () => {
      currentWorkspaceRootRef.current = "/other";

      return "App\\Models\\Comment";
    });
    const source = "{{ $comment->author() }}";

    await expect(
      provideBladeDefinition(
        source,
        offsetOf(source, "author"),
        makeDeps({
          currentWorkspaceRootRef,
          openDirectPhpMethodTarget,
          resolveBladeViewVariableTypeForView,
        }),
      ),
    ).resolves.toBe(false);
    expect(openDirectPhpMethodTarget).not.toHaveBeenCalled();
  });
});
