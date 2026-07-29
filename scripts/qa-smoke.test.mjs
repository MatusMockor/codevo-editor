import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";

import { qaSmokeProfiles, workbenchControllerPreviewSuites } from "./qa-smoke.mjs";

const expectedWorkbenchControllerPreviewSuites = [
  "src/application/useWorkbenchController.preview.test.tsx",
  "src/application/useWorkbenchController.preview/editing-trust-events-and-settings.test.tsx",
  "src/application/useWorkbenchController.preview/language-navigation-hierarchies-and-symbols.test.tsx",
  "src/application/useWorkbenchController.preview/laravel-blade-translations-and-navigation.test.tsx",
  "src/application/useWorkbenchController.preview/laravel-routes-config-and-views.test.tsx",
  "src/application/useWorkbenchController.preview/php-refactors-completions-and-quickfixes.test.tsx",
  "src/application/useWorkbenchController.preview/php-relations-and-diagnostics.test.tsx",
  "src/application/useWorkbenchController.preview/php-resolution-generics-and-inference.test.tsx",
  "src/application/useWorkbenchController.preview/workspace-diagnostics-cleanup-and-commands.test.tsx",
  "src/application/useWorkbenchController.preview/workspace-git-session-and-editor.test.tsx",
  "src/application/useWorkbenchController.preview/workspace-identity-and-project-lifecycle.test.tsx",
  "src/application/useWorkbenchController.preview/workspace-save-and-runtime-coordination.test.tsx",
  "src/application/useWorkbenchController.preview/workspace-search-tests-and-navigation.test.tsx",
];

describe("qa-smoke Vitest profiles", () => {
  it("keeps the extended profile aligned with every explicit controller preview suite", () => {
    expect(workbenchControllerPreviewSuites).toEqual(expectedWorkbenchControllerPreviewSuites);
    const splitSuiteDirectory = resolve(
      import.meta.dirname,
      "../src/application/useWorkbenchController.preview",
    );
    const discoveredWorkbenchControllerPreviewSuites = [
      "src/application/useWorkbenchController.preview.test.tsx",
      ...readdirSync(splitSuiteDirectory)
        .filter((fileName) => fileName.endsWith(".test.tsx"))
        .map((fileName) => `src/application/useWorkbenchController.preview/${fileName}`),
    ].sort();

    expect([...workbenchControllerPreviewSuites].sort()).toEqual(
      discoveredWorkbenchControllerPreviewSuites,
    );
    expect(qaSmokeProfiles.vitestExtended.files).toEqual([
      "src/components/RuntimeObservabilityPanel.test.tsx",
      "src/components/EditorSurface.test.tsx",
      ...expectedWorkbenchControllerPreviewSuites,
    ]);
    expect(qaSmokeProfiles.vitestExtended.command).toEqual([
      "npm",
      "test",
      "--",
      ...qaSmokeProfiles.vitestExtended.files,
    ]);
  });

  it("runs Blade and Laravel controller checks from their post-split suite", () => {
    const laravelSuites = [
      "src/application/useWorkbenchController.preview/laravel-blade-translations-and-navigation.test.tsx",
      "src/application/useWorkbenchController.preview/laravel-routes-config-and-views.test.tsx",
    ];
    const legacyEntry = "src/application/useWorkbenchController.preview.test.tsx";
    const profile = qaSmokeProfiles.vitestBladeLaravelViews;
    const configuredControllerSuites = profile.files.filter((fileName) =>
      fileName.startsWith("src/application/useWorkbenchController.preview"),
    );

    expect(configuredControllerSuites).toEqual(laravelSuites);
    expect(profile.command).toEqual(expect.arrayContaining(laravelSuites));
    expect(profile.files).not.toContain(legacyEntry);
    expect(profile.command).not.toContain(legacyEntry);
  });
});
