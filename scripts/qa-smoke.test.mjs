import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { agentAppSuiteDirectories, qaSmokeProfiles } from "./qa-smoke.mjs";

const repoRoot = resolve(import.meta.dirname, "..");
const removedEditorSubjects =
  /useWorkbenchController|languageServer|Monaco|EditorSurface|QuickOpen|php|Laravel|Blade|Nette|Latte|Neon|Problems|jsTest|RuntimeObservability|indexProgress/i;

const explicitTestFiles = (files) =>
  files.filter((file) => file.endsWith(".test.ts") || file.endsWith(".test.tsx"));

describe("qa-smoke Vitest profiles", () => {
  it("exposes only the agent app profiles", () => {
    expect(Object.keys(qaSmokeProfiles)).toEqual([
      "vitestFast",
      "vitestExtended",
      "vitestFull",
      "rustBackendSmoke",
    ]);
  });

  it("references only existing agent test files", () => {
    for (const profileName of ["vitestFast", "vitestExtended"]) {
      const files = explicitTestFiles(qaSmokeProfiles[profileName].files);
      expect(files.length).toBeGreaterThan(0);
      for (const file of files) {
        expect(existsSync(resolve(repoRoot, file)), file).toBe(true);
        expect(file).not.toMatch(removedEditorSubjects);
      }
    }
  });

  it("runs the agent app suites in the extended profile", () => {
    expect(agentAppSuiteDirectories).toEqual([
      "src/application/agentApp",
      "src/components/agentApp",
    ]);
    expect(qaSmokeProfiles.vitestExtended.files).toEqual(
      expect.arrayContaining(agentAppSuiteDirectories),
    );
    expect(qaSmokeProfiles.vitestExtended.command).toEqual([
      "npm",
      "test",
      "--",
      ...qaSmokeProfiles.vitestExtended.files,
    ]);
    expect(qaSmokeProfiles.vitestFast.command).toEqual([
      "npm",
      "test",
      "--",
      ...qaSmokeProfiles.vitestFast.files,
    ]);
  });

  it("keeps editor-only filters out of the Rust backend smoke", () => {
    for (const filter of qaSmokeProfiles.rustBackendSmoke.filters) {
      expect(filter).not.toMatch(/phpactor|tsserver|runtime_observability|reindex|startup_noise/);
    }
  });
});
