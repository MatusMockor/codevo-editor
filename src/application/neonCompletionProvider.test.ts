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
    readFileContent: vi.fn(async () => ""),
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
    const source = "serv";
    const completions = await provideNeonCompletions(
      makeContext(makeDeps()),
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
