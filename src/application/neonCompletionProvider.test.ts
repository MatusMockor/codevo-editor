import { describe, expect, it, vi } from "vitest";
import type { EditorPosition } from "../domain/languageServerFeatures";
import { phpNetteFrameworkProvider } from "../domain/phpFrameworkProviders";
import { createPhpFrameworkIntelligence } from "./phpFrameworkIntelligence";
import {
  provideNeonCompletions,
  type NeonCompletionDependencies,
} from "./neonCompletionProvider";
import {
  createNeonRequestContext,
  type NeonRequestContext,
} from "./neonIntelligenceRuntime";

const ROOT = "/ws";
const CURRENT_COMPOSER_LOCK = JSON.stringify({
  packages: [
    { name: "nette/database", version: "v3.2.9" },
    { name: "nette/di", version: "v3.2.6" },
    { name: "nette/mail", version: "v4.0.4" },
    { name: "nette/security", version: "v3.2.5" },
  ],
});
const NETTE_FRAMEWORK = createPhpFrameworkIntelligence({
  matchedProviderIds: ["nette"],
  profile: "nette",
  providers: [phpNetteFrameworkProvider],
});

function makeDeps(
  overrides: Partial<NeonCompletionDependencies> = {},
): NeonCompletionDependencies {
  return {
    currentWorkspaceRootRef: { current: ROOT },
    frameworkIntelligence: NETTE_FRAMEWORK,
    getActiveDocument: () => ({ path: `${ROOT}/config/config.neon` }),
    isSemanticIntelligenceActive: true,
    joinPath: (rootPath, relativePath) => `${rootPath}/${relativePath}`,
    listDirectory: vi.fn(async () => []),
    readFileContent: vi.fn(async (path: string) =>
      path.endsWith("/composer.lock") ? CURRENT_COMPOSER_LOCK : "",
    ),
    resolvePhpReceiverCompletions: vi.fn(async () => []),
    searchClassNames: vi.fn(async () => []),
    synthesizeTypedReceiverSource: (variableName, typeName) => ({
      position: { column: 1, lineNumber: 1 },
      source: `<?php /** @var ${typeName} $${variableName} */`,
    }),
    workspaceRoot: ROOT,
    ...overrides,
  };
}

function makeContext(
  deps: NeonCompletionDependencies,
): NeonRequestContext<NeonCompletionDependencies> {
  const context = createNeonRequestContext(deps, {}, new Map());

  expect(context).not.toBeNull();

  return context as NeonRequestContext<NeonCompletionDependencies>;
}

function positionAtOffset(source: string, offset: number): EditorPosition {
  const before = source.slice(0, offset).split("\n");

  return {
    column: (before[before.length - 1]?.length ?? 0) + 1,
    lineNumber: before.length,
  };
}

function endPosition(source: string): EditorPosition {
  return positionAtOffset(source, source.length);
}

describe("provideNeonCompletions config keys", () => {
  it("offers top-level sections filtered by the typed prefix", async () => {
    const readFileContent = vi.fn(async () => "");
    const source = "serv";
    const completions = await provideNeonCompletions(
      makeContext(makeDeps({ readFileContent })),
      source,
      endPosition(source),
    );

    expect(completions.map((item) => item.label)).toEqual(["services"]);
    expect(completions[0]).toMatchObject({
      insertText: "services:\n\t",
      kind: "parameter",
      replaceEnd: 4,
      replaceStart: 0,
    });
    expect(readFileContent).not.toHaveBeenCalled();
  });

  it("offers all sections on a blank top-level position", async () => {
    const source = "";
    const completions = await provideNeonCompletions(
      makeContext(makeDeps()),
      source,
      endPosition(source),
    );
    const labels = completions.map((item) => item.label);

    expect(labels).toContain("services");
    expect(labels).toContain("tracy");
    expect(labels).toContain("application");
  });

  it("offers section keys inside a known section", async () => {
    const source = "application:\n\terror";
    const completions = await provideNeonCompletions(
      makeContext(makeDeps()),
      source,
      endPosition(source),
    );

    expect(completions.map((item) => item.label)).toEqual(["errorPresenter"]);
    expect(completions[0]?.insertText).toBe("errorPresenter: ");
  });

  it("offers service keys inside a named service item", async () => {
    const source = "services:\n\tfoo:\n\t\tfa";
    const completions = await provideNeonCompletions(
      makeContext(makeDeps()),
      source,
      endPosition(source),
    );

    expect(completions.map((item) => item.label)).toEqual(["factory"]);
  });

  it("keeps old service keys but hides too-new keys in an older Nette DI project", async () => {
    const source = "services:\n\tfoo:\n\t\t";
    const readFileContent = vi.fn(async (path: string) =>
      path.endsWith("/composer.lock")
        ? JSON.stringify({
            packages: [{ name: "nette/di", version: "v3.1.9" }],
          })
        : "",
    );
    const completions = await provideNeonCompletions(
      makeContext(makeDeps({ readFileContent })),
      source,
      endPosition(source),
    );

    const labels = completions.map((completion) => completion.label);

    expect(labels).toContain("factory");
    expect(labels).not.toContain("lazy");
  });

  it("keeps baseline nested keys when Composer metadata is unknown", async () => {
    const source = "database:\n\tprimary:\n\t\tds";
    const completions = await provideNeonCompletions(
      makeContext(
        makeDeps({
          readFileContent: vi.fn(async () => {
            throw new Error("missing composer.lock");
          }),
        }),
      ),
      source,
      endPosition(source),
    );

    expect(completions.map((completion) => completion.label)).toEqual(["dsn"]);
  });

  it("drops package metadata loaded for a stale project root", async () => {
    const currentWorkspaceRootRef = { current: ROOT as string | null };
    const readFileContent = vi.fn(async () => {
      currentWorkspaceRootRef.current = "/other";
      return CURRENT_COMPOSER_LOCK;
    });
    const completions = await provideNeonCompletions(
      makeContext(makeDeps({ currentWorkspaceRootRef, readFileContent })),
      "services:\n\tfoo:\n\t\tla",
      { column: 5, lineNumber: 3 },
    );

    expect(completions).toEqual([]);
  });

  it("keeps Composer compatibility metadata isolated per workspace root", async () => {
    const configCache = {};
    const configInFlight = new Map();
    const readFileContent = vi.fn(async (path: string) => {
      if (path.startsWith("/current/")) {
        return CURRENT_COMPOSER_LOCK;
      }

      return JSON.stringify({
        packages: [{ name: "nette/di", version: "v3.1.9" }],
      });
    });
    const currentRootRef = { current: "/current" as string | null };
    const currentDeps = makeDeps({
      currentWorkspaceRootRef: currentRootRef,
      readFileContent,
      workspaceRoot: "/current",
    });
    const currentContext = createNeonRequestContext(
      currentDeps,
      configCache,
      configInFlight,
    );

    expect(currentContext).not.toBeNull();

    const current = await provideNeonCompletions(
      currentContext as NeonRequestContext<NeonCompletionDependencies>,
      "services:\n\tfoo:\n\t\tla",
      { column: 5, lineNumber: 3 },
    );

    currentRootRef.current = "/older";
    const olderDeps = makeDeps({
      currentWorkspaceRootRef: currentRootRef,
      readFileContent,
      workspaceRoot: "/older",
    });
    const olderContext = createNeonRequestContext(
      olderDeps,
      configCache,
      configInFlight,
    );

    expect(olderContext).not.toBeNull();

    const older = await provideNeonCompletions(
      olderContext as NeonRequestContext<NeonCompletionDependencies>,
      "services:\n\tfoo:\n\t\tla",
      { column: 5, lineNumber: 3 },
    );

    expect(current.map((completion) => completion.label)).toEqual(["lazy"]);
    expect(older).toEqual([]);
    expect(readFileContent).toHaveBeenCalledWith("/current/composer.lock");
    expect(readFileContent).toHaveBeenCalledWith("/older/composer.lock");
  });

  it("offers service keys inside an anonymous service item", async () => {
    const source = "services:\n\t-\n\t\t";
    const completions = await provideNeonCompletions(
      makeContext(makeDeps()),
      source,
      endPosition(source),
    );
    const labels = completions.map((item) => item.label);

    expect(labels).toContain("factory");
    expect(labels).toContain("create");
    expect(labels).toContain("setup");
    expect(labels).toContain("arguments");
    expect(labels).toContain("reset");
    expect(labels).not.toContain("alias");
    expect(labels).not.toContain("mapping");
  });

  it("offers keys inside named database connections", async () => {
    const source = "database:\n\tprimary:\n\t\tds";
    const completions = await provideNeonCompletions(
      makeContext(makeDeps()),
      source,
      endPosition(source),
    );

    expect(completions.map((item) => item.label)).toEqual(["dsn"]);
    expect(completions[0]?.detail).toBe("Database data source name");
  });

  it("offers keys inside nested search exclusions", async () => {
    const source = "search:\n\tapp:\n\t\texclude:\n\t\t\timp";
    const completions = await provideNeonCompletions(
      makeContext(makeDeps()),
      source,
      endPosition(source),
    );

    expect(completions.map((item) => item.label)).toEqual(["implements"]);
  });

  it("inserts nested section keys with one additional indent level", async () => {
    const source = "search:\n\tapp:\n\t\texc";
    const completions = await provideNeonCompletions(
      makeContext(makeDeps()),
      source,
      endPosition(source),
    );

    expect(completions.map((item) => item.label)).toEqual(["exclude"]);
    expect(completions[0]?.insertText).toBe("exclude:\n\t\t\t");
  });

  it("offers extension names as additional top-level sections", async () => {
    const source = "extensions:\n\tmyExt: App\\DI\\MyExtension\n\nmyE";
    const completions = await provideNeonCompletions(
      makeContext(makeDeps()),
      source,
      endPosition(source),
    );

    expect(completions.map((item) => item.label)).toEqual(["myExt"]);
    expect(completions[0]?.insertText).toBe("myExt:\n\t");
  });

  it("inserts only the key name when a colon already follows", async () => {
    const source = "tracy: true";
    const completions = await provideNeonCompletions(
      makeContext(makeDeps()),
      source,
      positionAtOffset(source, 3),
    );

    expect(completions.map((item) => item.label)).toEqual(["tracy"]);
    expect(completions[0]).toMatchObject({
      insertText: "tracy",
      replaceEnd: 5,
      replaceStart: 0,
    });
  });

  it("offers nothing at the service-name level of services", async () => {
    const source = "services:\n\tfo";
    const completions = await provideNeonCompletions(
      makeContext(makeDeps()),
      source,
      endPosition(source),
    );

    expect(completions).toEqual([]);
  });

  it("keeps class value completion working instead of key completion", async () => {
    const searchClassNames = vi.fn(async () => ["App\\Model\\Mailer"]);
    const source = "services:\n\tfoo:\n\t\tfactory: App";
    const completions = await provideNeonCompletions(
      makeContext(makeDeps({ searchClassNames })),
      source,
      endPosition(source),
    );

    expect(searchClassNames).toHaveBeenCalledWith(ROOT, "App", 100);
    expect(completions.map((item) => item.label)).toEqual([
      "App\\Model\\Mailer",
    ]);
    expect(completions[0]?.kind).toBe("class");
  });

  it("keeps parameter value completion working in value positions", async () => {
    const source =
      "parameters:\n\tappName: demo\nservices:\n\tfoo:\n\t\targuments: [%app";
    const completions = await provideNeonCompletions(
      makeContext(makeDeps()),
      source,
      endPosition(source),
    );

    expect(completions.map((item) => item.label)).toEqual(["appName"]);
    expect(completions[0]?.kind).toBe("parameter");
    expect(completions[0]?.detail).toBe("Nette parameter");
  });
});
