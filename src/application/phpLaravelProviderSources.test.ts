import { describe, expect, it, vi } from "vitest";
import type { FileEntry } from "../domain/workspace";
import { phpMethodCompletionsFromSource } from "../domain/phpMethodCompletions";
import { phpLaravelFrameworkProvider } from "../domain/phpFrameworkProviders";
import {
  isPhpLaravelProviderPath,
  loadPhpLaravelProviderSources,
  phpLaravelProvidersDirectory,
  phpLaravelProviderSourcesSignature,
  type PhpLaravelProviderSourceReader,
} from "./phpLaravelProviderSources";

function fileEntry(path: string): FileEntry {
  return {
    kind: "file",
    name: path.split("/").pop() ?? path,
    path,
  };
}

function directoryEntry(path: string): FileEntry {
  return {
    kind: "directory",
    name: path.split("/").pop() ?? path,
    path,
  };
}

function reader(
  entries: Record<string, FileEntry[]>,
  files: Record<string, string>,
): PhpLaravelProviderSourceReader {
  return {
    readDirectory: vi.fn(async (path: string) => {
      if (!(path in entries)) {
        throw new Error(`No such directory: ${path}`);
      }

      return entries[path];
    }),
    readTextFile: vi.fn(async (path: string) => {
      if (!(path in files)) {
        throw new Error(`No such file: ${path}`);
      }

      return files[path];
    }),
  };
}

describe("phpLaravelProvidersDirectory", () => {
  it("resolves the app/Providers directory under the root", () => {
    expect(phpLaravelProvidersDirectory("/workspace")).toBe(
      "/workspace/app/Providers",
    );
    expect(phpLaravelProvidersDirectory("/workspace/")).toBe(
      "/workspace/app/Providers",
    );
  });
});

describe("isPhpLaravelProviderPath", () => {
  it("matches any path inside the providers directory", () => {
    expect(
      isPhpLaravelProviderPath(
        "/workspace",
        "/workspace/app/Providers/AppServiceProvider.php",
      ),
    ).toBe(true);
    expect(
      isPhpLaravelProviderPath(
        "/workspace",
        "/workspace/app/Providers/Filament/AdminPanelProvider.php",
      ),
    ).toBe(true);
    expect(
      isPhpLaravelProviderPath("/workspace", "/workspace/app/Providers"),
    ).toBe(true);
  });

  it("rejects paths outside the providers directory or another root", () => {
    expect(
      isPhpLaravelProviderPath("/workspace", "/workspace/app/Models/User.php"),
    ).toBe(false);
    expect(
      isPhpLaravelProviderPath(
        "/workspace",
        "/workspace/app/Http/Controllers/UserController.php",
      ),
    ).toBe(false);
    // A sibling directory whose name merely starts with "Providers" must not match.
    expect(
      isPhpLaravelProviderPath(
        "/workspace",
        "/workspace/app/ProvidersExtra/Thing.php",
      ),
    ).toBe(false);
    expect(
      isPhpLaravelProviderPath(
        "/workspace-a",
        "/workspace-b/app/Providers/AppServiceProvider.php",
      ),
    ).toBe(false);
  });
});

describe("loadPhpLaravelProviderSources", () => {
  it("reads every PHP provider file and returns contents in a stable sorted order", async () => {
    const dir = "/workspace/app/Providers";
    const gateway = reader(
      {
        [dir]: [
          fileEntry(`${dir}/RouteServiceProvider.php`),
          fileEntry(`${dir}/AppServiceProvider.php`),
        ],
      },
      {
        [`${dir}/AppServiceProvider.php`]: "<?php // app",
        [`${dir}/RouteServiceProvider.php`]: "<?php // route",
      },
    );

    const sources = await loadPhpLaravelProviderSources("/workspace", gateway);

    // Sorted by path so the order (and therefore the signature) is stable.
    expect(sources).toEqual(["<?php // app", "<?php // route"]);
  });

  it("recurses into provider subdirectories", async () => {
    const dir = "/workspace/app/Providers";
    const gateway = reader(
      {
        [dir]: [
          fileEntry(`${dir}/AppServiceProvider.php`),
          directoryEntry(`${dir}/Filament`),
        ],
        [`${dir}/Filament`]: [
          fileEntry(`${dir}/Filament/AdminPanelProvider.php`),
        ],
      },
      {
        [`${dir}/AppServiceProvider.php`]: "<?php // app",
        [`${dir}/Filament/AdminPanelProvider.php`]: "<?php // admin",
      },
    );

    const sources = await loadPhpLaravelProviderSources("/workspace", gateway);

    expect(sources).toEqual(["<?php // app", "<?php // admin"]);
  });

  it("ignores non-PHP files", async () => {
    const dir = "/workspace/app/Providers";
    const gateway = reader(
      {
        [dir]: [
          fileEntry(`${dir}/AppServiceProvider.php`),
          fileEntry(`${dir}/.gitkeep`),
          fileEntry(`${dir}/notes.txt`),
        ],
      },
      {
        [`${dir}/AppServiceProvider.php`]: "<?php // app",
      },
    );

    const sources = await loadPhpLaravelProviderSources("/workspace", gateway);

    expect(sources).toEqual(["<?php // app"]);
  });

  it("is graceful when the providers directory does not exist", async () => {
    const gateway = reader({}, {});

    const sources = await loadPhpLaravelProviderSources("/workspace", gateway);

    expect(sources).toEqual([]);
    expect(gateway.readTextFile).not.toHaveBeenCalled();
  });

  it("skips an unreadable provider but keeps the others", async () => {
    const dir = "/workspace/app/Providers";
    const gateway = reader(
      {
        [dir]: [
          fileEntry(`${dir}/AppServiceProvider.php`),
          fileEntry(`${dir}/BrokenProvider.php`),
        ],
      },
      {
        [`${dir}/AppServiceProvider.php`]: "<?php // app",
      },
    );

    const sources = await loadPhpLaravelProviderSources("/workspace", gateway);

    expect(sources).toEqual(["<?php // app"]);
  });
});

describe("phpLaravelProviderSourcesSignature", () => {
  it("is stable for the same content and changes when content changes", () => {
    const a = phpLaravelProviderSourcesSignature(["<?php // a", "<?php // b"]);
    const same = phpLaravelProviderSourcesSignature([
      "<?php // a",
      "<?php // b",
    ]);
    const changed = phpLaravelProviderSourcesSignature([
      "<?php // a",
      "<?php // b2",
    ]);

    expect(a).toBe(same);
    expect(a).not.toBe(changed);
  });

  it("distinguishes a different number of provider files", () => {
    expect(phpLaravelProviderSourcesSignature([])).not.toBe(
      phpLaravelProviderSourcesSignature(["<?php"]),
    );
    // A boundary shift between two files must not collide with a single
    // concatenated file of the same bytes.
    expect(phpLaravelProviderSourcesSignature(["ab", "c"])).not.toBe(
      phpLaravelProviderSourcesSignature(["a", "bc"]),
    );
  });
});

// End-to-end S1 contract: a Builder::macro() registered in an app/Providers file
// is loaded by the provider-source loader and, when fed as `workspaceSources`,
// surfaces as an Eloquent Builder member completion through the real semantic
// engine. Only the file-system gateway is faked; the loader and completion
// engine are exercised as real collaborators.
describe("provider macro sources feed Eloquent Builder completions", () => {
  const laravelCompletionOptions = {
    frameworkProviders: [phpLaravelFrameworkProvider],
  };
  const editorSource = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Post;

Post::query()->withDash
`;

  function macroCompletionNames(workspaceSources: readonly string[]): string[] {
    return phpMethodCompletionsFromSource(
      editorSource,
      "Illuminate\\Database\\Eloquent\\Builder",
      {
        ...laravelCompletionOptions,
        frameworkSourceContext:
          workspaceSources.length > 0 ? { workspaceSources } : undefined,
      },
    ).map((completion) => completion.name);
  }

  it("surfaces a Builder::macro defined in an app/Providers file", async () => {
    const dir = "/workspace/app/Providers";
    const providerSource = `<?php
namespace App\\Providers;

use Illuminate\\Database\\Eloquent\\Builder;
use Illuminate\\Support\\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        Builder::macro('withDashboardScope', function (array $relations = []): Builder {
            return $this->with($relations);
        });
    }
}
`;
    const gateway = reader(
      { [dir]: [fileEntry(`${dir}/AppServiceProvider.php`)] },
      { [`${dir}/AppServiceProvider.php`]: providerSource },
    );

    const sources = await loadPhpLaravelProviderSources("/workspace", gateway);

    expect(macroCompletionNames(sources)).toContain("withDashboardScope");
  });

  it("surfaces no macro when there are no providers", async () => {
    const gateway = reader({}, {});

    const sources = await loadPhpLaravelProviderSources("/workspace", gateway);

    expect(sources).toEqual([]);
    expect(macroCompletionNames(sources)).not.toContain("withDashboardScope");
  });
});
