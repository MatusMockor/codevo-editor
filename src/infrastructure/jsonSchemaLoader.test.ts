import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  BUNDLED_JSON_SCHEMAS,
  loadJsonSchemaForDocument,
  type JsonSchemaLoaderDependencies,
} from "./jsonSchemaLoader";

interface FakeJsonDefaults {
  diagnosticsOptions: { validate?: boolean; schemas?: unknown[] };
  setDiagnosticsOptions: ReturnType<typeof vi.fn>;
}

function fakeJsonDefaults(): FakeJsonDefaults {
  const defaults: FakeJsonDefaults = {
    diagnosticsOptions: { validate: true, schemas: [] },
    setDiagnosticsOptions: vi.fn((options) => {
      defaults.diagnosticsOptions = options;
    }),
  };

  return defaults;
}

function monacoWith(jsonDefaults: FakeJsonDefaults) {
  return {
    languages: { json: { jsonDefaults } },
  } as never;
}

const PHPACTOR_SCHEMA = "/tools/phpactor/vendor/phpactor/phpactor.schema.json";
const DOCUMENT = "/project/.phpactor.json";
const DOCUMENT_CONTENT = JSON.stringify({ $schema: PHPACTOR_SCHEMA });
const SCHEMA_CONTENT = JSON.stringify({ type: "object" });

function deps(
  overrides: Partial<JsonSchemaLoaderDependencies> = {},
): JsonSchemaLoaderDependencies {
  return {
    readTextFile: vi.fn(async () => SCHEMA_CONTENT),
    isStale: () => false,
    ...overrides,
  };
}

describe("loadJsonSchemaForDocument", () => {
  it.each([
    ["/project/composer.json", "editor://schemas/composer.json"],
    ["/project/apps/site/package.json", "editor://schemas/package.json"],
    ["/project/tsconfig.json", "editor://schemas/tsconfig.json"],
    ["/project/tsconfig.build.json", "editor://schemas/tsconfig.json"],
    ["/project/packages/lib/jsconfig.json", "editor://schemas/jsconfig.json"],
    ["/project/packages/lib/jsconfig.test.json", "editor://schemas/jsconfig.json"],
  ])("registers the bundled schema matching %s", async (path, uri) => {
    const jsonDefaults = fakeJsonDefaults();
    const schema = { type: "object", properties: { name: { type: "string" } } };
    const matchingLoad = vi.fn(async () => schema);
    const otherLoad = vi.fn(async () => ({ type: "object" }));
    const bundledSchemas = BUNDLED_JSON_SCHEMAS.map((candidate) => ({
      ...candidate,
      load: candidate.uri === uri ? matchingLoad : otherLoad,
    }));
    const expected = BUNDLED_JSON_SCHEMAS.find(
      (candidate) => candidate.uri === uri,
    );

    await loadJsonSchemaForDocument(
      monacoWith(jsonDefaults),
      { path, content: "{}", language: "json" },
      deps({ bundledSchemas }),
    );

    expect(matchingLoad).toHaveBeenCalledTimes(1);
    expect(otherLoad).not.toHaveBeenCalled();
    expect(jsonDefaults.diagnosticsOptions.schemas).toContainEqual({
      uri,
      fileMatch: expected?.fileMatch,
      schema,
    });
  });

  it.each([
    "/project/config.json",
    "/project/mytsconfig.json",
    "/project/tsconfig.jsonc",
  ])("does not match the tsconfig bundled schema for %s", async (path) => {
    const jsonDefaults = fakeJsonDefaults();
    const load = vi.fn(async () => ({ type: "object" }));
    const bundledSchemas = BUNDLED_JSON_SCHEMAS.map((candidate) => ({
      ...candidate,
      load,
    }));

    await loadJsonSchemaForDocument(
      monacoWith(jsonDefaults),
      { path, content: "{}", language: "json" },
      deps({ bundledSchemas }),
    );

    expect(load).not.toHaveBeenCalled();
    expect(jsonDefaults.setDiagnosticsOptions).not.toHaveBeenCalled();
  });

  it("does not load a bundled schema for an unrelated JSON document", async () => {
    const jsonDefaults = fakeJsonDefaults();
    const load = vi.fn(async () => ({ type: "object" }));
    const bundledSchemas = BUNDLED_JSON_SCHEMAS.map((candidate) => ({
      ...candidate,
      load,
    }));

    await loadJsonSchemaForDocument(
      monacoWith(jsonDefaults),
      { path: "/project/config.json", content: "{}", language: "json" },
      deps({ bundledSchemas }),
    );

    expect(load).not.toHaveBeenCalled();
    expect(jsonDefaults.setDiagnosticsOptions).not.toHaveBeenCalled();
  });

  it("keeps an explicit local $schema ahead of the matching bundled schema", async () => {
    const jsonDefaults = fakeJsonDefaults();
    const bundledLoad = vi.fn(async () => ({ type: "object" }));
    const localSchema = JSON.stringify({
      type: "object",
      properties: { localOnly: { type: "boolean" } },
    });

    await loadJsonSchemaForDocument(
      monacoWith(jsonDefaults),
      {
        path: "/project/package.json",
        content: JSON.stringify({ $schema: "./local.schema.json" }),
        language: "json",
      },
      deps({
        readTextFile: vi.fn(async () => localSchema),
        bundledSchemas: BUNDLED_JSON_SCHEMAS.map((candidate) => ({
          ...candidate,
          load: bundledLoad,
        })),
      }),
    );

    expect(bundledLoad).not.toHaveBeenCalled();
    const schemas = jsonDefaults.diagnosticsOptions.schemas as Array<{
      uri: string;
    }>;
    expect(schemas.some((entry) => entry.uri === "./local.schema.json")).toBe(true);
    expect(
      schemas.some((entry) => entry.uri === "editor://schemas/package.json"),
    ).toBe(false);
  });

  it("registers each bundled schema once across workspace switches without replacing existing schemas", async () => {
    const jsonDefaults = fakeJsonDefaults();
    jsonDefaults.diagnosticsOptions.schemas = [
      { uri: "editor://schemas/existing.json", schema: { type: "object" } },
    ];
    const loads = new Map(
      BUNDLED_JSON_SCHEMAS.map((candidate) => [
        candidate.uri,
        vi.fn(async () => ({ title: candidate.uri })),
      ]),
    );
    const bundledSchemas = BUNDLED_JSON_SCHEMAS.map((candidate) => ({
      ...candidate,
      load: loads.get(candidate.uri)!,
    }));
    const monaco = monacoWith(jsonDefaults);

    for (const path of [
      "/workspace-a/package.json",
      "/workspace-b/composer.json",
      "/workspace-c/package.json",
      "/workspace-d/composer.json",
      "/workspace-e/tsconfig.json",
      "/workspace-f/tsconfig.node.json",
      "/workspace-g/jsconfig.json",
      "/workspace-h/jsconfig.test.json",
    ]) {
      await loadJsonSchemaForDocument(
        monaco,
        { path, content: "{}", language: "json" },
        deps({ bundledSchemas }),
      );
    }

    const schemas = jsonDefaults.diagnosticsOptions.schemas as Array<{
      uri: string;
    }>;
    expect(schemas.map((entry) => entry.uri)).toEqual([
      "editor://schemas/existing.json",
      "editor://schemas/package.json",
      "editor://schemas/composer.json",
      "editor://schemas/tsconfig.json",
      "editor://schemas/jsconfig.json",
    ]);
    expect(loads.get("editor://schemas/package.json")).toHaveBeenCalledTimes(1);
    expect(loads.get("editor://schemas/composer.json")).toHaveBeenCalledTimes(1);
    expect(loads.get("editor://schemas/tsconfig.json")).toHaveBeenCalledTimes(1);
    expect(loads.get("editor://schemas/jsconfig.json")).toHaveBeenCalledTimes(1);
  });

  it("bundles the complete pinned SchemaStore TypeScript and JavaScript schemas", () => {
    const tsconfigPath = fileURLToPath(
      new URL("../assets/schemas/tsconfig.schema.json", import.meta.url),
    );
    const jsconfigPath = fileURLToPath(
      new URL("../assets/schemas/jsconfig.schema.json", import.meta.url),
    );
    const tsconfigContent = readFileSync(tsconfigPath, "utf8");
    const jsconfigContent = readFileSync(jsconfigPath, "utf8");
    const tsconfig = JSON.parse(tsconfigContent);
    const jsconfig = JSON.parse(jsconfigContent);

    expect(tsconfigContent.length).toBeGreaterThan(400_000);
    expect(jsconfigContent.length).toBeGreaterThan(90_000);
    expect(tsconfig.definitions.compilerOptionsDefinition).toBeDefined();
    expect(
      tsconfig.definitions.compilerOptionsDefinition.properties.compilerOptions
        .properties.rewriteRelativeImportExtensions,
    ).toBeDefined();
    expect(jsconfig.$id).toBe("https://json.schemastore.org/jsconfig.json");
    expect(
      jsconfig.definitions.compilerOptionsDefinition.properties.compilerOptions
        .anyOf[0].properties.checkJs,
    ).toBeDefined();
  });

  it("reads the local $schema file and registers it inline so Monaco never hits the request service", async () => {
    const jsonDefaults = fakeJsonDefaults();
    const readTextFile = vi.fn(async () => SCHEMA_CONTENT);

    await loadJsonSchemaForDocument(
      monacoWith(jsonDefaults),
      { path: DOCUMENT, content: DOCUMENT_CONTENT, language: "json" },
      deps({ readTextFile }),
    );

    expect(readTextFile).toHaveBeenCalledWith(PHPACTOR_SCHEMA);
    expect(jsonDefaults.setDiagnosticsOptions).toHaveBeenCalledTimes(1);
    const options = jsonDefaults.setDiagnosticsOptions.mock.calls[0][0];
    expect(options.validate).toBe(true);
    const uris = options.schemas.map((entry: { uri: string }) => entry.uri);
    expect(uris).toContain(PHPACTOR_SCHEMA);
  });

  it("resolves relative local $schema paths against the JSON document before reading and registering", async () => {
    const jsonDefaults = fakeJsonDefaults();
    const readTextFile = vi.fn(async () => SCHEMA_CONTENT);
    const documentPath = "/project/config/.phpactor.json";

    await loadJsonSchemaForDocument(
      monacoWith(jsonDefaults),
      {
        path: documentPath,
        content: JSON.stringify({ $schema: "./schemas/phpactor.schema.json" }),
        language: "json",
      },
      deps({ readTextFile }),
    );

    expect(readTextFile).toHaveBeenCalledWith(
      "/project/config/schemas/phpactor.schema.json",
    );
    expect(jsonDefaults.setDiagnosticsOptions).toHaveBeenCalledTimes(1);
    const options = jsonDefaults.setDiagnosticsOptions.mock.calls[0][0];
    const uris = options.schemas.map((entry: { uri: string }) => entry.uri);
    expect(uris).toContain("./schemas/phpactor.schema.json");
    expect(uris).toContain("/project/config/schemas/phpactor.schema.json");
    expect(uris).toContain("file:///project/config/schemas/phpactor.schema.json");
  });

  it("does nothing for non-JSON documents", async () => {
    const jsonDefaults = fakeJsonDefaults();
    const readTextFile = vi.fn(async () => SCHEMA_CONTENT);

    await loadJsonSchemaForDocument(
      monacoWith(jsonDefaults),
      { path: "/project/App.php", content: "<?php", language: "php" },
      deps({ readTextFile }),
    );

    expect(readTextFile).not.toHaveBeenCalled();
    expect(jsonDefaults.setDiagnosticsOptions).not.toHaveBeenCalled();
  });

  it("does nothing when the JSON document has no local $schema", async () => {
    const jsonDefaults = fakeJsonDefaults();
    const readTextFile = vi.fn(async () => SCHEMA_CONTENT);

    await loadJsonSchemaForDocument(
      monacoWith(jsonDefaults),
      { path: DOCUMENT, content: JSON.stringify({ includes: [] }), language: "json" },
      deps({ readTextFile }),
    );

    expect(readTextFile).not.toHaveBeenCalled();
    expect(jsonDefaults.setDiagnosticsOptions).not.toHaveBeenCalled();
  });

  it("registers a permissive placeholder under the $schema id when the schema file cannot be read (suppresses the 768 fetch error without crashing)", async () => {
    const jsonDefaults = fakeJsonDefaults();
    const readTextFile = vi.fn(async () => {
      throw new Error("ENOENT");
    });

    await expect(
      loadJsonSchemaForDocument(
        monacoWith(jsonDefaults),
        { path: DOCUMENT, content: DOCUMENT_CONTENT, language: "json" },
        deps({ readTextFile }),
      ),
    ).resolves.toBeUndefined();

    expect(jsonDefaults.setDiagnosticsOptions).toHaveBeenCalledTimes(1);
    const options = jsonDefaults.setDiagnosticsOptions.mock.calls[0][0];
    const entry = options.schemas.find(
      (candidate: { uri: string }) => candidate.uri === PHPACTOR_SCHEMA,
    );
    expect(entry).toBeDefined();
    expect(entry.schema).toEqual({});
  });

  it("registers a permissive placeholder when the schema file content is not valid JSON", async () => {
    const jsonDefaults = fakeJsonDefaults();
    const readTextFile = vi.fn(async () => "{ not json");

    await loadJsonSchemaForDocument(
      monacoWith(jsonDefaults),
      { path: DOCUMENT, content: DOCUMENT_CONTENT, language: "json" },
      deps({ readTextFile }),
    );

    expect(jsonDefaults.setDiagnosticsOptions).toHaveBeenCalledTimes(1);
    const options = jsonDefaults.setDiagnosticsOptions.mock.calls[0][0];
    const entry = options.schemas.find(
      (candidate: { uri: string }) => candidate.uri === PHPACTOR_SCHEMA,
    );
    expect(entry.schema).toEqual({});
  });

  it("drops the result when the workspace/document became stale during the async read (per-workspace isolation)", async () => {
    const jsonDefaults = fakeJsonDefaults();
    const readTextFile = vi.fn(async () => SCHEMA_CONTENT);

    await loadJsonSchemaForDocument(
      monacoWith(jsonDefaults),
      { path: DOCUMENT, content: DOCUMENT_CONTENT, language: "json" },
      deps({ readTextFile, isStale: () => true }),
    );

    expect(jsonDefaults.setDiagnosticsOptions).not.toHaveBeenCalled();
  });

  it("does not call setDiagnosticsOptions again when the schema is already registered (idempotent reopen)", async () => {
    const jsonDefaults = fakeJsonDefaults();

    await loadJsonSchemaForDocument(
      monacoWith(jsonDefaults),
      { path: DOCUMENT, content: DOCUMENT_CONTENT, language: "json" },
      deps(),
    );
    await loadJsonSchemaForDocument(
      monacoWith(jsonDefaults),
      { path: DOCUMENT, content: DOCUMENT_CONTENT, language: "json" },
      deps(),
    );

    expect(jsonDefaults.setDiagnosticsOptions).toHaveBeenCalledTimes(1);
  });

  it("does not re-read the schema file once registered, even as the document content changes (no per-keystroke disk read)", async () => {
    const jsonDefaults = fakeJsonDefaults();
    const readTextFile = vi.fn(async () => SCHEMA_CONTENT);
    const monaco = monacoWith(jsonDefaults);

    await loadJsonSchemaForDocument(
      monaco,
      { path: DOCUMENT, content: DOCUMENT_CONTENT, language: "json" },
      deps({ readTextFile }),
    );

    expect(readTextFile).toHaveBeenCalledTimes(1);

    // Simulate later keystrokes: same document + $schema, different trailing
    // content. The schema is already registered, so no further disk read fires.
    for (const suffix of ["\n", "\n  ", "\n  // edit"]) {
      await loadJsonSchemaForDocument(
        monaco,
        {
          path: DOCUMENT,
          content: `${DOCUMENT_CONTENT}${suffix}`,
          language: "json",
        },
        deps({ readTextFile }),
      );
    }

    expect(readTextFile).toHaveBeenCalledTimes(1);
    expect(jsonDefaults.setDiagnosticsOptions).toHaveBeenCalledTimes(1);
  });
});

describe("bundled JSON schema assets", () => {
  it("matches pinned SchemaStore provenance and records its license", () => {
    const provenance = readBundledSchemaAsset(
      "typescript-config-schemas.provenance.json",
    ) as {
      formatVersion: number;
      revision: string;
      license: { spdx: string; source: string; sha256: string };
      schemas: Array<{ target: string; sha256: string }>;
    };

    expect(provenance.formatVersion).toBe(1);
    expect(provenance.revision).toMatch(/^[0-9a-f]{40}$/);
    expect(provenance.license).toEqual({
      spdx: "Apache-2.0",
      source: "LICENSE",
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    for (const schema of provenance.schemas) {
      const content = readBundledSchemaBuffer(schema.target);
      expect(createHash("sha256").update(content).digest("hex")).toBe(
        schema.sha256,
      );
    }
  });

  it.each([
    "composer.schema.json",
    "package.schema.json",
    "tsconfig.schema.json",
    "jsconfig.schema.json",
  ])("%s contains no remote $ref", (fileName) => {
    const schema = readBundledSchemaAsset(fileName);
    const remoteRefs: string[] = [];

    collectRemoteRefs(schema, remoteRefs);

    expect(remoteRefs).toEqual([]);
  });

  it("tsconfig.schema.json exposes the top-level tsconfig sections", () => {
    const schema = readBundledSchemaAsset("tsconfig.schema.json");
    const definitionKeys = Object.values(
      schema.definitions as Record<
        string,
        { properties?: Record<string, unknown> }
      >,
    ).flatMap((definition) => Object.keys(definition.properties ?? {}));

    expect(definitionKeys).toEqual(
      expect.arrayContaining([
        "compilerOptions",
        "include",
        "exclude",
        "files",
        "extends",
        "references",
        "watchOptions",
      ]),
    );
  });

  it("tsconfig.schema.json describes the most-used compilerOptions with enums", () => {
    const schema = readBundledSchemaAsset("tsconfig.schema.json");
    const compilerOptions = (
      schema.definitions as Record<
        string,
        {
          properties?: Record<
            string,
            {
              properties?: Record<
                string,
                {
                  enum?: string[];
                  anyOf?: Array<{ enum?: string[] }>;
                  description?: string;
                }
              >;
            }
          >;
        }
      >
    ).compilerOptionsDefinition.properties?.compilerOptions.properties ?? {};

    for (const option of [
      "target",
      "module",
      "moduleResolution",
      "lib",
      "jsx",
      "strict",
      "strictNullChecks",
      "strictFunctionTypes",
      "strictBindCallApply",
      "strictPropertyInitialization",
      "noImplicitAny",
      "noImplicitThis",
      "alwaysStrict",
      "useUnknownInCatchVariables",
      "esModuleInterop",
      "skipLibCheck",
      "outDir",
      "rootDir",
      "baseUrl",
      "paths",
      "types",
      "typeRoots",
      "declaration",
      "sourceMap",
      "noEmit",
      "allowJs",
      "checkJs",
      "resolveJsonModule",
      "isolatedModules",
      "verbatimModuleSyntax",
      "incremental",
      "composite",
      "noUncheckedIndexedAccess",
      "noImplicitOverride",
      "allowImportingTsExtensions",
      "moduleDetection",
      "customConditions",
    ]) {
      expect(compilerOptions, `missing compilerOptions.${option}`).toHaveProperty(
        option,
      );
      expect(
        compilerOptions[option].description,
        `missing description for compilerOptions.${option}`,
      ).toBeTruthy();
    }

    const enumValues = (option: {
      enum?: string[];
      anyOf?: Array<{ enum?: string[] }>;
    }): string[] => [
      ...(option.enum ?? []),
      ...(option.anyOf ?? []).flatMap((candidate) => candidate.enum ?? []),
    ];

    expect(enumValues(compilerOptions.target)).toEqual(
      expect.arrayContaining(["es5", "es2022", "esnext"]),
    );
    expect(enumValues(compilerOptions.module)).toEqual(
      expect.arrayContaining(["commonjs", "esnext", "node16", "nodenext", "preserve"]),
    );
    expect(enumValues(compilerOptions.moduleResolution)).toEqual(
      expect.arrayContaining(["node16", "nodenext", "bundler"]),
    );
    expect(enumValues(compilerOptions.jsx)).toEqual(
      expect.arrayContaining(["preserve", "react-jsx", "react-jsxdev"]),
    );
    expect(enumValues(compilerOptions.moduleDetection)).toEqual(
      expect.arrayContaining(["auto", "legacy", "force"]),
    );
  });
});

function readBundledSchemaAsset(fileName: string): Record<string, unknown> {
  return JSON.parse(readBundledSchemaBuffer(fileName).toString("utf8")) as Record<
    string,
    unknown
  >;
}

function readBundledSchemaBuffer(fileName: string): Buffer {
  return readFileSync(
    fileURLToPath(new URL(`../assets/schemas/${fileName}`, import.meta.url)),
  );
}

function collectRemoteRefs(value: unknown, remoteRefs: string[]): void {
  if (!value || typeof value !== "object") {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectRemoteRefs(item, remoteRefs);
    }
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    if (
      key === "$ref" &&
      typeof child === "string" &&
      /^https?:\/\//.test(child)
    ) {
      remoteRefs.push(child);
    }
    collectRemoteRefs(child, remoteRefs);
  }
}
