import { describe, expect, it, vi } from "vitest";
import type { FileEntry } from "../domain/workspace";
import {
  createPhpNetteTranslationTargetResolver,
  findPhpNetteAjaxSnippetTarget,
  type PhpNetteTranslationTargetResolverDeps,
} from "./phpNetteFrameworkTargetAdapter";

const ROOT = "/workspace";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });

  return { promise, resolve };
}

function fileEntry(path: string): FileEntry {
  const name = path.slice(path.lastIndexOf("/") + 1);

  return { name, path, kind: "file" };
}

function directoryEntry(path: string): FileEntry {
  const name = path.slice(path.lastIndexOf("/") + 1);

  return { name, path, kind: "directory" };
}

function relativeWorkspacePath(workspaceRoot: string, path: string): string {
  const normalizedRoot = workspaceRoot.replace(/\/+$/, "");

  if (path.startsWith(`${normalizedRoot}/`)) {
    return path.slice(normalizedRoot.length + 1);
  }

  return path;
}

function joinWorkspacePath(workspaceRoot: string, relativePath: string): string {
  return `${workspaceRoot.replace(/\/+$/, "")}/${relativePath}`;
}

interface Harness {
  ref: { current: string | null };
  readFileContent: ReturnType<typeof vi.fn>;
  readWorkspaceDirectory: ReturnType<typeof vi.fn>;
  readCachedTranslationTargets: ReturnType<typeof vi.fn>;
  writeCachedTranslationTargets: ReturnType<typeof vi.fn>;
  resolver: ReturnType<typeof createPhpNetteTranslationTargetResolver>;
}

function createHarness(
  overrides: Partial<PhpNetteTranslationTargetResolverDeps> = {},
): Harness {
  const ref: { current: string | null } = { current: ROOT };
  const readFileContent = vi.fn(async () => "");
  const readWorkspaceDirectory = vi.fn(async () => [] as FileEntry[]);
  const readCachedTranslationTargets = vi.fn(() => null);
  const writeCachedTranslationTargets = vi.fn();

  const deps: PhpNetteTranslationTargetResolverDeps = {
    currentWorkspaceRootRef: ref,
    workspaceRoot: ROOT,
    readNavigationFileContent: readFileContent as never,
    readWorkspaceDirectory: readWorkspaceDirectory as never,
    relativeWorkspacePath,
    joinWorkspacePath,
    supportsTranslations: () => true,
    readCachedTranslationTargets,
    writeCachedTranslationTargets,
    ...overrides,
  };

  return {
    ref,
    readFileContent: deps.readNavigationFileContent as ReturnType<typeof vi.fn>,
    readWorkspaceDirectory: deps.readWorkspaceDirectory as ReturnType<
      typeof vi.fn
    >,
    readCachedTranslationTargets: deps.readCachedTranslationTargets as ReturnType<
      typeof vi.fn
    >,
    writeCachedTranslationTargets:
      deps.writeCachedTranslationTargets as ReturnType<typeof vi.fn>,
    resolver: createPhpNetteTranslationTargetResolver(deps),
  };
}

describe("createPhpNetteTranslationTargetResolver", () => {
  it("collects NEON translation keys from app and module lang roots", async () => {
    const appLang = `${ROOT}/app/lang`;
    const rootLang = `${ROOT}/lang`;
    const modulesRoot = `${ROOT}/app/modules`;
    const usersModule = `${modulesRoot}/usersModule`;
    const usersLang = `${usersModule}/lang`;
    const appSource = `title: Dashboard\n`;
    const rootSource = `submit: Submit\n`;
    const usersSource = `foo: Foo\nnested:\n  bar: Bar\n`;
    const harness = createHarness({
      readWorkspaceDirectory: vi.fn(async (path: string) => {
        if (path === rootLang) {
          return [fileEntry(`${rootLang}/forms.en.neon`)];
        }

        if (path === appLang) {
          return [fileEntry(`${appLang}/dashboard.en.neon`)];
        }

        if (path === modulesRoot) {
          return [directoryEntry(usersModule)];
        }

        if (path === usersModule) {
          return [directoryEntry(usersLang)];
        }

        if (path === usersLang) {
          return [
            fileEntry(`${usersLang}/users.cs_CZ.neon`),
            fileEntry(`${usersLang}/ignored.neon`),
          ];
        }

        return [];
      }) as never,
      readNavigationFileContent: vi.fn(async (path: string) => {
        if (path === `${appLang}/dashboard.en.neon`) {
          return appSource;
        }

        if (path === `${rootLang}/forms.en.neon`) {
          return rootSource;
        }

        if (path === `${usersLang}/users.cs_CZ.neon`) {
          return usersSource;
        }

        throw new Error(`unexpected read ${path}`);
      }) as never,
    });

    const targets = await harness.resolver.collect();

    expect(targets).toEqual([
      {
        key: "dashboard.title",
        path: `${appLang}/dashboard.en.neon`,
        position: { column: 1, lineNumber: 1 },
        relativePath: "app/lang/dashboard.en.neon",
      },
      {
        key: "forms.submit",
        path: `${rootLang}/forms.en.neon`,
        position: { column: 1, lineNumber: 1 },
        relativePath: "lang/forms.en.neon",
      },
      {
        key: "users.foo",
        path: `${usersLang}/users.cs_CZ.neon`,
        position: { column: 1, lineNumber: 1 },
        relativePath: "app/modules/usersModule/lang/users.cs_CZ.neon",
      },
      {
        key: "users.nested.bar",
        path: `${usersLang}/users.cs_CZ.neon`,
        position: { column: 3, lineNumber: 3 },
        relativePath: "app/modules/usersModule/lang/users.cs_CZ.neon",
      },
    ]);
    expect(harness.writeCachedTranslationTargets).toHaveBeenCalledWith(
      ROOT,
      targets,
    );
  });

  it("finds a translation target at the parser position in the matching domain file", async () => {
    const modulesRoot = `${ROOT}/app/modules`;
    const usersModule = `${modulesRoot}/usersModule`;
    const usersLang = `${usersModule}/lang`;
    const source = `foo: Foo\nnested:\n  bar: Bar\n`;
    const harness = createHarness({
      readWorkspaceDirectory: vi.fn(async (path: string) => {
        if (path === modulesRoot) {
          return [directoryEntry(usersModule)];
        }

        if (path === usersModule) {
          return [directoryEntry(usersLang)];
        }

        if (path === usersLang) {
          return [
            fileEntry(`${usersLang}/orders.en.neon`),
            fileEntry(`${usersLang}/users.cs_CZ.neon`),
          ];
        }

        return [];
      }) as never,
      readNavigationFileContent: vi.fn(async (path: string) => {
        if (path === `${usersLang}/users.cs_CZ.neon`) {
          return source;
        }

        throw new Error(`unexpected read ${path}`);
      }) as never,
    });

    await expect(harness.resolver.find("users.nested.bar")).resolves.toEqual({
      key: "users.nested.bar",
      path: `${usersLang}/users.cs_CZ.neon`,
      position: { column: 3, lineNumber: 3 },
      relativePath: "app/modules/usersModule/lang/users.cs_CZ.neon",
    });
    expect(harness.readFileContent).not.toHaveBeenCalledWith(
      `${usersLang}/orders.en.neon`,
    );
  });

  it("collects nested module lang files recursively", async () => {
    const modulesRoot = `${ROOT}/app/modules`;
    const adminModule = `${modulesRoot}/admin`;
    const usersModule = `${adminModule}/usersModule`;
    const usersLang = `${usersModule}/lang`;
    const nestedLang = `${usersLang}/mail`;
    const harness = createHarness({
      readWorkspaceDirectory: vi.fn(async (path: string) => {
        if (path === modulesRoot) {
          return [directoryEntry(adminModule)];
        }

        if (path === adminModule) {
          return [directoryEntry(usersModule)];
        }

        if (path === usersModule) {
          return [directoryEntry(usersLang)];
        }

        if (path === usersLang) {
          return [directoryEntry(nestedLang)];
        }

        if (path === nestedLang) {
          return [fileEntry(`${nestedLang}/users.en.neon`)];
        }

        return [];
      }) as never,
      readNavigationFileContent: vi.fn(async (path: string) => {
        if (path === `${nestedLang}/users.en.neon`) {
          return `welcome: Welcome\n`;
        }

        throw new Error(`unexpected read ${path}`);
      }) as never,
    });

    await expect(harness.resolver.collect()).resolves.toEqual([
      {
        key: "users.welcome",
        path: `${nestedLang}/users.en.neon`,
        position: { column: 1, lineNumber: 1 },
        relativePath: "app/modules/admin/usersModule/lang/mail/users.en.neon",
      },
    ]);
  });

  it("finds a translation target from the collection cache before scanning files", async () => {
    const cachedTarget = {
      key: "users.cached",
      path: `${ROOT}/app/modules/usersModule/lang/users.en.neon`,
      position: { column: 1, lineNumber: 2 },
      relativePath: "app/modules/usersModule/lang/users.en.neon",
    };
    const harness = createHarness({
      readCachedTranslationTargets: vi.fn(() => [cachedTarget]) as never,
    });

    await expect(harness.resolver.find("users.cached")).resolves.toEqual(
      cachedTarget,
    );
    expect(harness.readCachedTranslationTargets).toHaveBeenCalledWith(ROOT);
    expect(harness.readWorkspaceDirectory).not.toHaveBeenCalled();
    expect(harness.readFileContent).not.toHaveBeenCalled();
  });

  it("returns empty results without reading or caching when translations are unsupported", async () => {
    const harness = createHarness({
      supportsTranslations: () => false,
    });

    await expect(harness.resolver.collect()).resolves.toEqual([]);
    await expect(harness.resolver.find("users.foo")).resolves.toBeNull();
    expect(harness.readCachedTranslationTargets).not.toHaveBeenCalled();
    expect(harness.readWorkspaceDirectory).not.toHaveBeenCalled();
    expect(harness.readFileContent).not.toHaveBeenCalled();
    expect(harness.writeCachedTranslationTargets).not.toHaveBeenCalled();
  });

  it("drops a collection and skips the cache write when the workspace root changes mid-flight", async () => {
    const deferred = createDeferred<FileEntry[]>();
    const harness = createHarness({
      readWorkspaceDirectory: vi.fn((path: string) =>
        path === `${ROOT}/app/modules` ? deferred.promise : Promise.resolve([]),
      ) as never,
    });

    const pending = harness.resolver.collect();
    harness.ref.current = "/other";
    deferred.resolve([directoryEntry(`${ROOT}/app/modules/usersModule`)]);

    await expect(pending).resolves.toEqual([]);
    expect(harness.writeCachedTranslationTargets).not.toHaveBeenCalled();
  });
});

describe("findPhpNetteAjaxSnippetTarget", () => {
  it("finds a static snippet in a colocated component template", async () => {
    const readNavigationFileContent = vi.fn(async (path: string) => {
      if (
        path ===
        `${ROOT}/app/modules/mailerModule/Components/MailLogs/mail_logs.latte`
      ) {
        return `<div>
    {snippet mailLogslisting}
    {/snippet}
</div>
`;
      }

      throw new Error(`unexpected read ${path}`);
    });

    await expect(
      findPhpNetteAjaxSnippetTarget(
        `${ROOT}/app/modules/mailerModule/Components/MailLogs/MailLogs.php`,
        "mailLogslisting",
        {
          currentWorkspaceRootRef: { current: ROOT },
          workspaceRoot: ROOT,
          readNavigationFileContent,
          relativeWorkspacePath,
          joinWorkspacePath,
        },
      ),
    ).resolves.toEqual({
      name: "mailLogslisting",
      path: `${ROOT}/app/modules/mailerModule/Components/MailLogs/mail_logs.latte`,
      position: { column: 14, lineNumber: 2 },
      relativePath:
        "app/modules/mailerModule/Components/MailLogs/mail_logs.latte",
    });
  });

  it("does not scan non-component presenter paths", async () => {
    const readNavigationFileContent = vi.fn(async () => "");

    await expect(
      findPhpNetteAjaxSnippetTarget(
        `${ROOT}/app/modules/mailerModule/presenters/MailPresenter.php`,
        "mailLogslisting",
        {
          currentWorkspaceRootRef: { current: ROOT },
          workspaceRoot: ROOT,
          readNavigationFileContent,
          relativeWorkspacePath,
          joinWorkspacePath,
        },
      ),
    ).resolves.toBeNull();
    expect(readNavigationFileContent).not.toHaveBeenCalled();
  });
});
