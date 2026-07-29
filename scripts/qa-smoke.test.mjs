import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";

import { qaSmokeProfiles, workbenchControllerPreviewSuites } from "./qa-smoke.mjs";

const expectedWorkbenchControllerPreviewSuites = [
  "src/application/useWorkbenchController.preview.test.tsx",
  "src/application/useWorkbenchController.preview/editing-file-events-settings-and-outline.test.tsx",
  "src/application/useWorkbenchController.preview/editing-trust-runtime-and-renames.test.tsx",
  "src/application/useWorkbenchController.preview/laravel-latte-blade-and-navigation.test.tsx",
  "src/application/useWorkbenchController.preview/laravel-routes-config-translations-and-definitions.test.tsx",
  "src/application/useWorkbenchController.preview/navigation-php-hierarchies-and-definitions.test.tsx",
  "src/application/useWorkbenchController.preview/navigation-search-and-symbols.test.tsx",
  "src/application/useWorkbenchController.preview/php-diagnostics-relations-and-definitions.test.tsx",
  "src/application/useWorkbenchController.preview/php-refactors-and-quickfixes.test.tsx",
  "src/application/useWorkbenchController.preview/php-resolution-generics-and-inference.test.tsx",
  "src/application/useWorkbenchController.preview/workspace-lifecycle-identity-and-commands.test.tsx",
  "src/application/useWorkbenchController.preview/workspace-save-runtime-switch-and-cleanup.test.tsx",
  "src/application/useWorkbenchController.preview/workspace-session-git-and-editor.test.tsx",
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
      "src/application/useWorkbenchController.preview/laravel-latte-blade-and-navigation.test.tsx",
      "src/application/useWorkbenchController.preview/laravel-routes-config-translations-and-definitions.test.tsx",
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
