import { describe, expect, it } from "vitest";
import {
  MAX_ALIAS_CANDIDATES,
  MAX_ALIAS_ENTRIES,
  createTsPathAliasResolver,
} from "./tsPathAliasResolver";

describe("createTsPathAliasResolver", () => {
  it("resolves exact aliases relative to baseUrl", () => {
    const { resolve, truncated } = createTsPathAliasResolver({
      compilerOptions: {
        baseUrl: "packages/server",
        paths: {
          "@app": ["src/app"],
        },
      },
    });

    expect(resolve("@app")).toEqual(["packages/server/src/app"]);
    expect(resolve("@app/other")).toEqual([]);
    expect(truncated).toBe(false);
  });

  it("resolves nested config aliases relative to the config directory", () => {
    const { resolve, truncated } = createTsPathAliasResolver(
      {
        compilerOptions: {
          baseUrl: ".",
          paths: {
            "@routes/*": ["src/routes/*"],
          },
        },
      },
      { configDirectory: "packages/api" },
    );

    expect(resolve("@routes/users")).toEqual(["packages/api/src/routes/users"]);
    expect(truncated).toBe(false);
  });

  it("rejects malformed config-directory authority", () => {
    const { resolve, truncated } = createTsPathAliasResolver(
      {
        compilerOptions: {
          paths: {
            "@routes": ["src/routes"],
          },
        },
      },
      { configDirectory: "../outside" },
    );

    expect(resolve("@routes")).toEqual([]);
    expect(truncated).toBe(false);
  });

  it("keeps an explicitly inherited baseUrl at its declaring config provenance", () => {
    const parent = createTsPathAliasResolver(
      {
        compilerOptions: {
          baseUrl: ".",
          paths: {
            "@parent": ["src/parent"],
          },
        },
      },
      { configDirectory: "configs" },
    );
    const child = createTsPathAliasResolver(
      {
        compilerOptions: {
          paths: {
            "@child": ["src/child"],
          },
        },
      },
      {
        configDirectory: "packages/api",
        inheritedBaseUrl: parent.resolvedBaseUrl ?? undefined,
      },
    );

    expect(parent.resolvedBaseUrl).toBe("configs");
    expect(child.resolvedBaseUrl).toBe("configs");
    expect(child.resolve("@child")).toEqual(["configs/src/child"]);
  });

  it("substitutes single-wildcard aliases into bounded target patterns", () => {
    const { resolve } = createTsPathAliasResolver({
      compilerOptions: {
        baseUrl: "src",
        paths: {
          "~server/*": ["server/*", "generated/*"],
        },
      },
    });

    expect(resolve("~server/api/users")).toEqual([
      "src/server/api/users",
      "src/generated/api/users",
    ]);
  });

  it("substitutes dollar-ampersand wildcard values literally", () => {
    const { resolve } = createTsPathAliasResolver({
      compilerOptions: {
        paths: {
          "@/*": ["src/*"],
        },
      },
    });

    expect(resolve("@/routes/$&/handler")).toEqual(["src/routes/$&/handler"]);
  });

  it("uses the longest matching prefix and most-specific pattern", () => {
    const { resolve } = createTsPathAliasResolver({
      compilerOptions: {
        paths: {
          "@/*": ["src/*"],
          "@/routes/*": ["src/http/routes/*"],
          "@/routes/internal/*": ["src/private/*"],
          "@/routes/internal/root": ["src/root"],
        },
      },
    });

    expect(resolve("@/routes/internal/root")).toEqual(["src/root"]);
    expect(resolve("@/routes/internal/users")).toEqual(["src/private/users"]);
    expect(resolve("@/routes/public")).toEqual(["src/http/routes/public"]);
  });

  it("reports truncation when the alias-entry cap is exceeded", () => {
    const paths = Object.fromEntries(
      Array.from({ length: MAX_ALIAS_ENTRIES + 1 }, (_, index) => [
        `@alias-${index}`,
        [`src/alias-${index}`],
      ]),
    );
    const { resolve, truncated } = createTsPathAliasResolver({ compilerOptions: { paths } });

    expect(resolve(`@alias-${MAX_ALIAS_ENTRIES - 1}`)).toEqual([
      `src/alias-${MAX_ALIAS_ENTRIES - 1}`,
    ]);
    expect(resolve(`@alias-${MAX_ALIAS_ENTRIES}`)).toEqual([]);
    expect(truncated).toBe(true);
  });

  it("reports truncation when the per-alias candidate cap is exceeded", () => {
    const { resolve, truncated } = createTsPathAliasResolver({
      compilerOptions: {
        paths: {
          "@app": Array.from(
            { length: MAX_ALIAS_CANDIDATES + 1 },
            (_, index) => `src/app-${index}`,
          ),
        },
      },
    });

    expect(resolve("@app")).toEqual(
      Array.from({ length: MAX_ALIAS_CANDIDATES }, (_, index) => `src/app-${index}`),
    );
    expect(truncated).toBe(true);
  });

  it("skips malformed tsconfig fragments deterministically", () => {
    const { resolve } = createTsPathAliasResolver({
      compilerOptions: {
        baseUrl: "./",
        paths: {
          "@/valid": ["src/valid", 42, "../outside"],
          "@/**": ["src/*"],
          "@/not-an-array": "src/bad",
          "@exact": ["src/*"],
        },
      },
    });

    expect(resolve("@/valid")).toEqual(["src/valid"]);
    expect(resolve("@/anything")).toEqual([]);
    expect(resolve("@exact")).toEqual([]);
  });

  it("rejects absolute POSIX targets", () => {
    const { resolve } = createTsPathAliasResolver({
      compilerOptions: {
        paths: {
          "@passwd": ["/etc/passwd"],
        },
      },
    });

    expect(resolve("@passwd")).toEqual([]);
  });

  it("rejects Windows-style absolute targets", () => {
    const { resolve } = createTsPathAliasResolver({
      compilerOptions: {
        paths: {
          "@drive": ["C:\\x"],
        },
      },
    });

    expect(resolve("@drive")).toEqual([]);
  });

  it("rejects targets containing backslashes", () => {
    const { resolve } = createTsPathAliasResolver({
      compilerOptions: {
        paths: {
          "@backslash": ["src\\x"],
        },
      },
    });

    expect(resolve("@backslash")).toEqual([]);
  });

  it("rejects wildcard traversal values that escape the workspace", () => {
    const { resolve } = createTsPathAliasResolver({
      compilerOptions: {
        paths: {
          "@/*": ["src/*"],
        },
      },
    });

    expect(resolve("@/../../../etc/passwd")).toEqual([]);
  });

  it("matches and substitutes suffix wildcard aliases", () => {
    const { resolve } = createTsPathAliasResolver({
      compilerOptions: {
        paths: {
          "*.ext": ["generated/*.ts"],
        },
      },
    });

    expect(resolve("widget.ext")).toEqual(["generated/widget.ts"]);
    expect(resolve("widget.other")).toEqual([]);
  });

  it("matches and substitutes bare wildcard aliases", () => {
    const { resolve } = createTsPathAliasResolver({
      compilerOptions: {
        paths: {
          "*": ["fallback/*"],
        },
      },
    });

    expect(resolve("nested/module")).toEqual(["fallback/nested/module"]);
  });
});
