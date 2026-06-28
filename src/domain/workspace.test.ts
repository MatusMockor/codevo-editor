import { describe, expect, it } from "vitest";
import {
  detectLanguage,
  getFileName,
  getParentPath,
  isDirty,
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
