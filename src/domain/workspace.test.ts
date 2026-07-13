import { describe, expect, it } from "vitest";
import {
  detectLanguage,
  getFileName,
  getParentPath,
  isDirty,
  isLspExcludedDirectoryPath,
  javaScriptTypeScriptProjectScopeLabel,
  javaScriptTypeScriptVersionLabel,
  javaScriptTypeScriptWorkspaceLabel,
  joinWorkspacePath,
  workspaceRelativePath,
  nextActiveEditorPathAfterClose,
  visibleEditorPaths,
  type EditorDocument,
  type JavaScriptTypeScriptProjectDescriptor,
} from "./workspace";

describe("workspace path helpers", () => {
  it("extracts file names from normalized and trailing-slash paths", () => {
    expect(getFileName("/project/src/User.php")).toBe("User.php");
    expect(getFileName("C:\\project\\src\\User.php")).toBe("User.php");
    expect(getFileName("/project/src/")).toBe("src");
  });

  it("detects language from the file name instead of dotted directories", () => {
    expect(detectLanguage("/project.v1/src/User.php")).toBe("php");
    expect(detectLanguage("/project.v1/resources/views/comments/show.blade.php")).toBe(
      "blade",
    );
    expect(detectLanguage("/project.v1/src/README")).toBe("plaintext");
  });

  it("detects JavaScript and TypeScript Node module extensions", () => {
    expect(detectLanguage("/project/src/server.mjs")).toBe("javascript");
    expect(detectLanguage("/project/src/server.cjs")).toBe("javascript");
    expect(detectLanguage("/project/src/server.mts")).toBe("typescript");
    expect(detectLanguage("/project/src/server.cts")).toBe("typescript");
  });

  it("detects Vue single-file components", () => {
    expect(detectLanguage("/project/src/components/App.vue")).toBe("vue");
    expect(detectLanguage("/project.v1/src/HelloWorld.vue")).toBe("vue");
  });

  it.each([
    ["/project/.env", "dotenv"],
    ["/project/.env.local", "dotenv"],
    ["/project/.env.example", "dotenv"],
    ["/project/local.env", "dotenv"],
    ["/project/env", "plaintext"],
    ["/project/src/.env", "dotenv"],
    ["/project/.environment", "plaintext"],
  ])("detects dotenv files for %s", (path, language) => {
    expect(detectLanguage(path)).toBe(language);
  });

  it("detects Nette Latte templates and NEON config files", () => {
    expect(detectLanguage("/project/app/UI/Product/show.latte")).toBe("latte");
    expect(detectLanguage("/project/app/Presenters/templates/@layout.latte")).toBe(
      "latte",
    );
    expect(detectLanguage("/project/config/services.neon")).toBe("neon");
    expect(detectLanguage("/project.v1/config/common.neon")).toBe("neon");
  });

  it("does not let Latte/NEON detection disturb neighbouring languages", () => {
    expect(detectLanguage("/project/resources/views/show.blade.php")).toBe(
      "blade",
    );
    expect(detectLanguage("/project/app/Product.php")).toBe("php");
    expect(detectLanguage("/project/config/app.yaml")).toBe("yaml");
    expect(detectLanguage("/project/config/app.yml")).toBe("yaml");
  });

  it("normalizes parent and joined paths", () => {
    expect(getParentPath("C:\\project\\src\\User.php")).toBe("C:/project/src");
    expect(joinWorkspacePath("C:\\project\\", "\\src\\User.php")).toBe(
      "C:/project/src/User.php",
    );
  });

  it("derives a workspace-relative path from an absolute child path", () => {
    expect(
      workspaceRelativePath("/project", "/project/app/Services/Foo.php"),
    ).toBe("app/Services/Foo.php");
    expect(
      workspaceRelativePath("/project/", "/project/app/Foo.php"),
    ).toBe("app/Foo.php");
    expect(
      workspaceRelativePath("C:\\project", "C:\\project\\src\\Foo.php"),
    ).toBe("src/Foo.php");
  });

  it("returns null when the path is outside the workspace root", () => {
    expect(workspaceRelativePath("/project", "/other/Foo.php")).toBeNull();
    expect(workspaceRelativePath("/project", "/project")).toBeNull();
    expect(workspaceRelativePath("/project", "/projectile/Foo.php")).toBeNull();
  });

  it.each([
    "/project/vendor",
    "/project/node_modules",
    "/project/.git",
    "/project/target",
    "/project/dist",
    "/project/build",
    "/project/.next",
    "/project/.turbo",
    "/project/.cache",
    "/project/coverage",
  ])("marks %s as LSP-excluded", (path) => {
    expect(isLspExcludedDirectoryPath("/project", path)).toBe(true);
  });

  it("marks directories nested inside an excluded tree as LSP-excluded", () => {
    expect(
      isLspExcludedDirectoryPath("/project", "/project/node_modules/pkg"),
    ).toBe(true);
    expect(
      isLspExcludedDirectoryPath("/project", "/project/vendor/laravel/framework"),
    ).toBe(true);
    expect(
      isLspExcludedDirectoryPath("/project", "/project/app/vendor/generated"),
    ).toBe(true);
  });

  it("does not mark normal directories as LSP-excluded", () => {
    expect(isLspExcludedDirectoryPath("/project", "/project/src/models")).toBe(
      false,
    );
    expect(isLspExcludedDirectoryPath("/project", "/project/app/Services")).toBe(
      false,
    );
    expect(isLspExcludedDirectoryPath("/project", "/project/vendors")).toBe(
      false,
    );
    expect(isLspExcludedDirectoryPath("/project", "/project/my-dist")).toBe(
      false,
    );
  });

  it("matches excluded directory names case-sensitively", () => {
    expect(isLspExcludedDirectoryPath("/project", "/project/Vendor")).toBe(
      false,
    );
    expect(isLspExcludedDirectoryPath("/project", "/project/NODE_MODULES")).toBe(
      false,
    );
  });

  it("ignores excluded names in segments above the workspace root", () => {
    expect(
      isLspExcludedDirectoryPath("/home/user/build/project", "/home/user/build/project/src"),
    ).toBe(false);
    expect(isLspExcludedDirectoryPath("/project", "/other/vendor")).toBe(false);
    expect(isLspExcludedDirectoryPath("/project", "/project")).toBe(false);
  });

  it("detects dirty editor documents", () => {
    const document: EditorDocument = {
      content: "changed",
      language: "php",
      name: "User.php",
      path: "/project/src/User.php",
      savedContent: "saved",
    };

    expect(isDirty(document)).toBe(true);
    expect(isDirty({ ...document, savedContent: "changed" })).toBe(false);
  });

  it("adds one preview tab after pinned editor tabs", () => {
    expect(visibleEditorPaths(["/project/A.php"], null)).toEqual([
      "/project/A.php",
    ]);
    expect(visibleEditorPaths(["/project/A.php"], "/project/B.php")).toEqual([
      "/project/A.php",
      "/project/B.php",
    ]);
    expect(visibleEditorPaths(["/project/A.php"], "/project/A.php")).toEqual([
      "/project/A.php",
    ]);
  });

  it("selects the next visible editor path after closing a tab", () => {
    expect(
      nextActiveEditorPathAfterClose(
        "/project/A.php",
        ["/project/A.php"],
        "/project/C.php",
      ),
    ).toBe("/project/C.php");
    expect(
      nextActiveEditorPathAfterClose(
        "/project/C.php",
        ["/project/A.php", "/project/B.php"],
        "/project/C.php",
      ),
    ).toBe("/project/B.php");
    expect(nextActiveEditorPathAfterClose("/project/A.php", [], null)).toBe(
      null,
    );
  });

  it("labels JavaScript and TypeScript workspace status like an editor service selector", () => {
    const descriptor: JavaScriptTypeScriptProjectDescriptor = {
      frameworks: ["React", "Vite", "Express", "NestJS"],
      hasJsconfig: false,
      hasPackageJson: true,
      hasTsconfig: true,
      packageManager: "pnpm",
      packageName: "example-web",
      typeScriptDependencyVersion: "^5.9.0",
      usesTypeScript: true,
      workspaceTypeScriptVersion: "5.9.2",
    };

    expect(javaScriptTypeScriptVersionLabel(descriptor, "workspace")).toBe(
      "TS 5.9.2 workspace",
    );
    expect(javaScriptTypeScriptVersionLabel(descriptor, "bundled")).toBe(
      "TS bundled · workspace 5.9.2",
    );
    expect(javaScriptTypeScriptProjectScopeLabel(descriptor)).toBe(
      "Project-wide",
    );
    expect(javaScriptTypeScriptWorkspaceLabel(descriptor, "workspace")).toBe(
      "example-web · React + Vite + Express · TypeScript · Project-wide · TS 5.9.2 workspace · pnpm",
    );
  });

  it("labels missing workspace TypeScript before falling back to bundled service", () => {
    const descriptor: JavaScriptTypeScriptProjectDescriptor = {
      frameworks: [],
      hasJsconfig: false,
      hasPackageJson: true,
      hasTsconfig: true,
      packageManager: "npm",
      packageName: "example-web",
      typeScriptDependencyVersion: "^5.9.0",
      usesTypeScript: true,
      workspaceTypeScriptVersion: null,
    };

    expect(javaScriptTypeScriptVersionLabel(descriptor, "workspace")).toBe(
      "TS ^5.9.0 dependency",
    );
  });

  it("labels inferred JavaScript and TypeScript projects as partial", () => {
    const descriptor: JavaScriptTypeScriptProjectDescriptor = {
      frameworks: [],
      hasJsconfig: false,
      hasPackageJson: true,
      hasTsconfig: false,
      packageManager: "npm",
      packageName: "example-web",
      typeScriptDependencyVersion: null,
      usesTypeScript: false,
      workspaceTypeScriptVersion: null,
    };

    expect(javaScriptTypeScriptProjectScopeLabel(descriptor)).toBe(
      "Inferred (partial)",
    );
    expect(javaScriptTypeScriptWorkspaceLabel(descriptor, "bundled")).toBe(
      "example-web · JS/TS · Inferred (partial) · npm",
    );
  });
});
