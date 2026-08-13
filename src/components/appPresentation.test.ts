import { describe, expect, it } from "vitest";
import type {
  JavaScriptTypeScriptProjectDescriptor,
  PhpProjectDescriptor,
  WorkspaceDescriptor,
} from "../domain/workspace";
import { workspaceInfoLabel, type WorkspaceInfoLabelInput } from "./appPresentation";

describe("workspaceInfoLabel", () => {
  it("returns null without a descriptor", () => {
    expect(workspaceInfoLabel(input({ workspaceDescriptor: null }))).toBeNull();
  });

  it("prefers the JS/TS label while a JS/TS file is active", () => {
    const label = workspaceInfoLabel(
      input({
        activeLanguage: "typescript",
        workspaceDescriptor: descriptor({ javaScriptTypeScript: jsTs(), php: php() }),
      }),
    );

    expect(label).toContain("acme-web");
    expect(label).toContain("TypeScript");
  });

  it("falls back to the JS/TS label when the workspace has no PHP project", () => {
    const label = workspaceInfoLabel(
      input({
        activeLanguage: "php",
        workspaceDescriptor: descriptor({ javaScriptTypeScript: jsTs(), php: null }),
      }),
    );

    expect(label).toContain("acme-web");
  });

  it("labels a PHP workspace with the version override and tool availability", () => {
    const label = workspaceInfoLabel(
      input({
        phpTools: {
          intelephense: null,
          phpactor: {
            executable: "phpactor",
            path: "/workspace/vendor/bin/phpactor",
            source: "workspaceVendorBin",
          },
        },
        phpVersionOverride: "8.3",
        workspaceDescriptor: descriptor({ javaScriptTypeScript: null, php: php() }),
      }),
    );

    expect(label).toBe("acme/api · PHP 8.3 · Project PHPactor");
  });

  it("reports missing PHP tools truthfully", () => {
    const label = workspaceInfoLabel(
      input({ workspaceDescriptor: descriptor({ javaScriptTypeScript: null, php: php() }) }),
    );

    expect(label).toBe("acme/api · PHP 8.2 · PHP tools missing");
  });
});

function input(overrides: Partial<WorkspaceInfoLabelInput>): WorkspaceInfoLabelInput {
  return {
    activeLanguage: null,
    javaScriptTypeScriptVersion: "bundled",
    phpTools: null,
    phpVersionOverride: null,
    workspaceDescriptor: null,
    ...overrides,
  };
}

function descriptor(overrides: Partial<WorkspaceDescriptor>): WorkspaceDescriptor {
  return {
    rootPath: "/workspace",
    php: null,
    javaScriptTypeScript: null,
    ...overrides,
  };
}

function jsTs(): JavaScriptTypeScriptProjectDescriptor {
  return {
    hasPackageJson: true,
    hasTsconfig: true,
    hasJsconfig: false,
    packageName: "acme-web",
    packageManager: null,
    frameworks: [],
    typeScriptDependencyVersion: null,
    usesTypeScript: true,
    workspaceTypeScriptVersion: null,
  };
}

function php(): PhpProjectDescriptor {
  return {
    classmapRoots: [],
    hasComposer: true,
    packageName: "acme/api",
    packages: [],
    phpPlatformVersion: null,
    phpVersionConstraint: "8.2",
    psr4Roots: [],
  };
}
