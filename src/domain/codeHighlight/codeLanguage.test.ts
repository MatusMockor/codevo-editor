import { describe, expect, it } from "vitest";
import {
  CODE_LANGUAGE_IDS,
  codeLanguageForFence,
  codeLanguageForPath,
  isCodeLanguageId,
  type CodeLanguageId,
} from "./codeLanguage";

describe("codeLanguageForPath", () => {
  const cases: ReadonlyArray<readonly [string, CodeLanguageId]> = [
    ["src/index.js", "javascript"],
    ["scripts/build.mjs", "javascript"],
    ["config.cjs", "javascript"],
    ["App.jsx", "jsx"],
    ["src/main.ts", "typescript"],
    ["vite.config.mts", "typescript"],
    ["lib.cts", "typescript"],
    ["Button.tsx", "tsx"],
    ["package.json", "json"],
    ["settings.jsonc", "jsonc"],
    ["tsconfig.json", "jsonc"],
    ["tsconfig.app.json", "jsonc"],
    ["packages/a/tsconfig.build.json", "jsonc"],
    ["index.html", "html"],
    ["legacy.HTM", "html"],
    ["style.css", "css"],
    ["theme.scss", "scss"],
    ["vars.less", "less"],
    ["app/Model.php", "php"],
    ["resources/views/home.blade.php", "blade"],
    ["app/templates/@layout.latte", "latte"],
    ["config/common.neon", "neon"],
    ["App.vue", "vue"],
    ["README.md", "markdown"],
    ["docs/page.mdx", "markdown"],
    [".github/workflows/ci.yml", "yaml"],
    ["docker-compose.yaml", "yaml"],
    ["Cargo.toml", "toml"],
    ["pom.xml", "xml"],
    ["icon.svg", "xml"],
    ["schema.sql", "sql"],
    ["deploy.sh", "shellscript"],
    ["run.bash", "shellscript"],
    ["init.zsh", "shellscript"],
    ["main.py", "python"],
    ["src/lib.rs", "rust"],
    ["cmd/main.go", "go"],
    [".env", "dotenv"],
    [".env.local", "dotenv"],
    ["apps/web/.env.production", "dotenv"],
    ["Dockerfile", "dockerfile"],
    ["docker/Dockerfile.dev", "dockerfile"],
    ["api.dockerfile", "dockerfile"],
    ["php.ini", "ini"],
    ["nginx.conf", "ini"],
    ["changes.diff", "diff"],
    ["fix.patch", "diff"],
    ["Makefile", "plaintext"],
    ["LICENSE", "plaintext"],
    ["archive.tar.gz", "plaintext"],
    ["", "plaintext"],
    ["src/", "plaintext"],
    ["C:\\repo\\src\\Main.TS", "typescript"],
    ["DOCKERFILE", "dockerfile"],
    ["README.MD", "markdown"],
  ];

  it.each(cases)("maps %s to %s", (path, expected) => {
    expect(codeLanguageForPath(path)).toBe(expected);
  });

  it("never throws on odd inputs", () => {
    for (const path of [".", "..", "///", "a.", ".hidden", "x".repeat(10_000)]) {
      expect(isCodeLanguageId(codeLanguageForPath(path))).toBe(true);
    }
  });
});

describe("codeLanguageForFence", () => {
  it("resolves common fence infos and aliases", () => {
    expect(codeLanguageForFence("ts")).toBe("typescript");
    expect(codeLanguageForFence("TypeScript")).toBe("typescript");
    expect(codeLanguageForFence('tsx title="a.tsx"')).toBe("tsx");
    expect(codeLanguageForFence("js{1,3}")).toBe("javascript");
    expect(codeLanguageForFence("bash")).toBe("shellscript");
    expect(codeLanguageForFence("console")).toBe("shellscript");
    expect(codeLanguageForFence("py")).toBe("python");
    expect(codeLanguageForFence("golang")).toBe("go");
    expect(codeLanguageForFence("jsonc")).toBe("jsonc");
    expect(codeLanguageForFence("yml")).toBe("yaml");
    expect(codeLanguageForFence("docker")).toBe("dockerfile");
    expect(codeLanguageForFence("text")).toBe("plaintext");
    expect(codeLanguageForFence("diff")).toBe("diff");
  });

  it("returns null for missing or unknown fences", () => {
    expect(codeLanguageForFence(null)).toBeNull();
    expect(codeLanguageForFence("")).toBeNull();
    expect(codeLanguageForFence("   ")).toBeNull();
    expect(codeLanguageForFence("brainfuck")).toBeNull();
  });
});

describe("isCodeLanguageId", () => {
  it("accepts exactly the closed set", () => {
    for (const id of CODE_LANGUAGE_IDS) expect(isCodeLanguageId(id)).toBe(true);
    expect(isCodeLanguageId("docker")).toBe(false);
    expect(isCodeLanguageId("TypeScript")).toBe(false);
  });
});
