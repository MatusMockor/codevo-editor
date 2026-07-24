import { describe, expect, it, vi } from "vitest";
import type { NeonSemanticDiagnosticRule } from "../domain/neonSemanticDiagnostics";
import type { NeonSemanticDiagnostic } from "../domain/neonSemanticDiagnostics";
import { provideNeonSemanticDiagnostics } from "./neonSemanticDiagnosticsProvider";
import type { NeonCrossFileRepository } from "./neonCrossFileSymbolSweep";
import { createNeonIntelligence } from "./neonProviderFlows";
import { createPhpFrameworkIntelligence } from "./phpFrameworkIntelligence";

describe("provideNeonSemanticDiagnostics", () => {
  it("uses the complete include component and open overlays", async () => {
    const files = {
      "/ws/config/config.neon": "includes:\n  - services\n  - consumer\n",
      "/ws/config/services.neon": "services:\n  diskMailer: App\\DiskMailer\n",
      "/ws/config/consumer.neon": "services:\n  consumer: App\\Consumer(@mailer)\n",
    };
    const repository = repo(files, "/ws/config/consumer.neon", {
      openOverlays: new Map([["/ws/config/services.neon", "services:\n  mailer: App\\Mailer\n"]]),
    });

    await expect(provideNeonSemanticDiagnostics(repository)).resolves.toEqual([]);
  });

  it("returns an authoritative clear for an incomplete repository", async () => {
    const repository = repo(
      { "/ws/config.neon": "includes:\n  - missing\nservices:\n  x: App\\X(@unknown)" },
      "/ws/config.neon",
    );

    await expect(provideNeonSemanticDiagnostics(repository)).resolves.toEqual([]);
  });

  it("returns null when repository ownership becomes stale", async () => {
    let current = true;
    const repository = repo(
      { "/ws/config.neon": "services:\n  x: App\\X(@unknown)" },
      "/ws/config.neon",
      {
        isCurrent: () => current,
        readFile: async () => {
          current = false;
          return "services:\n  x: App\\X(@unknown)";
        },
      },
    );

    await expect(provideNeonSemanticDiagnostics(repository)).resolves.toBeNull();
  });

  it("accepts an injected rule pipeline", async () => {
    const rule: NeonSemanticDiagnosticRule = {
      id: "neon.unresolvedService",
      evaluate: vi.fn((): readonly NeonSemanticDiagnostic[] => [
        {
          code: "neon.unresolvedService",
          message: "Injected",
          path: "/ws/config.neon",
          severity: "warning",
          span: { start: 0, end: 1 },
        },
      ]),
    };
    const repository = repo({ "/ws/config.neon": "services:\n  x: App\\X" }, "/ws/config.neon");

    await expect(provideNeonSemanticDiagnostics(repository, [rule])).resolves.toMatchObject([
      { message: "Injected" },
    ]);
    expect(rule.evaluate).toHaveBeenCalledOnce();
  });

  it("does not inspect a repository when Nette NEON intelligence is inactive", async () => {
    const repository = repo(
      { "/ws/config.neon": "services:\n  x: App\\X(@unknown)" },
      "/ws/config.neon",
    );
    const listNeonFiles = vi.spyOn(repository, "listNeonFiles");
    const intelligence = createNeonIntelligence(() => ({
      currentWorkspaceRootRef: { current: "/ws" },
      frameworkIntelligence: createPhpFrameworkIntelligence({
        matchedProviderIds: [],
        profile: "generic",
        providers: [],
      }),
      getActiveDocument: () => ({ path: "/ws/config.neon" }),
      isSemanticIntelligenceActive: true,
      joinPath: (root, relative) => `${root}/${relative}`,
      listDirectory: async () => [],
      openClassTarget: async () => false,
      openDirectPhpMethodTarget: async () => false,
      openTarget: async () => false,
      readFileContent: async () => "",
      resolvePhpReceiverCompletions: async () => [],
      searchClassNames: async () => [],
      setImplementationChooser: () => undefined,
      synthesizeTypedReceiverSource: () => ({
        position: { column: 1, lineNumber: 1 },
        source: "",
      }),
      toRelativePath: (_root, path) => path,
      workspaceRoot: "/ws",
    }));

    await expect(intelligence.provideNeonSemanticDiagnostics(repository)).resolves.toEqual([]);
    expect(listNeonFiles).not.toHaveBeenCalled();
  });
});

function repo(
  files: Readonly<Record<string, string>>,
  activePath: string,
  overrides: Partial<NeonCrossFileRepository> = {},
): NeonCrossFileRepository {
  return {
    activePath,
    rootPath: "/ws",
    listNeonFiles: async () => Object.keys(files),
    readFile: async (path) => files[path] ?? null,
    ...overrides,
  };
}
