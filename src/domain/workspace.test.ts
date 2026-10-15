import { describe, expect, it } from "vitest";
import {
  detectLanguage,
  getFileName,
  getParentPath,
  joinWorkspacePath,
  workspaceRelativePath,
} from "./workspace";

describe("workspace path helpers", () => {
  it("extracts file names from normalized and trailing-slash paths", () => {
    expect(getFileName("/project/src/User.php")).toBe("User.php");
    expect(getFileName("C:\\project\\src\\User.php")).toBe("User.php");
    expect(getFileName("/project/src/")).toBe("src");
  });

  it("detects language from the file name instead of dotted directories", () => {
    expect(detectLanguage("/project.v1/src/User.php")).toBe("php");
    expect(detectLanguage("/project.v1/resources/views/comments/show.blade.php")).toBe("blade");
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
    expect(detectLanguage("/project/app/Presenters/templates/@layout.latte")).toBe("latte");
    expect(detectLanguage("/project/config/services.neon")).toBe("neon");
    expect(detectLanguage("/project.v1/config/common.neon")).toBe("neon");
  });

  it("does not let Latte/NEON detection disturb neighbouring languages", () => {
    expect(detectLanguage("/project/resources/views/show.blade.php")).toBe("blade");
    expect(detectLanguage("/project/app/Product.php")).toBe("php");
    expect(detectLanguage("/project/config/app.yaml")).toBe("yaml");
    expect(detectLanguage("/project/config/app.yml")).toBe("yaml");
  });

  it("normalizes parent and joined paths", () => {
    expect(getParentPath("C:\\project\\src\\User.php")).toBe("C:/project/src");
    expect(joinWorkspacePath("C:\\project\\", "\\src\\User.php")).toBe("C:/project/src/User.php");
  });

  it("derives a workspace-relative path from an absolute child path", () => {
    expect(workspaceRelativePath("/project", "/project/app/Services/Foo.php")).toBe(
      "app/Services/Foo.php",
    );
    expect(workspaceRelativePath("/project/", "/project/app/Foo.php")).toBe("app/Foo.php");
    expect(workspaceRelativePath("C:\\project", "C:\\project\\src\\Foo.php")).toBe("src/Foo.php");
  });

  it("returns null when the path is outside the workspace root", () => {
    expect(workspaceRelativePath("/project", "/other/Foo.php")).toBeNull();
    expect(workspaceRelativePath("/project", "/project")).toBeNull();
    expect(workspaceRelativePath("/project", "/projectile/Foo.php")).toBeNull();
  });
});
