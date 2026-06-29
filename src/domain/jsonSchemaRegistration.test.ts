import { describe, expect, it } from "vitest";
import {
  buildJsonSchemaRegistration,
  buildPlaceholderSchemaRegistration,
  extractLocalSchemaReference,
  isSchemaReferenceRegistered,
  mergeJsonSchemaIntoDiagnosticsOptions,
} from "./jsonSchemaRegistration";

describe("extractLocalSchemaReference", () => {
  it("returns the absolute local path declared in a JSON document's $schema", () => {
    const content = JSON.stringify({
      $schema: "/Users/me/tools/phpactor/phpactor.schema.json",
      includes: [],
    });

    expect(extractLocalSchemaReference(content)).toBe(
      "/Users/me/tools/phpactor/phpactor.schema.json",
    );
  });

  it("returns a relative local path declared in a JSON document's $schema", () => {
    const content = JSON.stringify({
      $schema: "./schemas/phpactor.schema.json",
    });

    expect(extractLocalSchemaReference(content)).toBe(
      "./schemas/phpactor.schema.json",
    );
  });

  it("ignores http(s) $schema references (those are remote, not local files)", () => {
    const content = JSON.stringify({
      $schema: "https://json.schemastore.org/composer.json",
    });

    expect(extractLocalSchemaReference(content)).toBeNull();
  });

  it("ignores file:// $schema references (already a URI, not a plain disk path)", () => {
    const content = JSON.stringify({
      $schema: "file:///Users/me/phpactor.schema.json",
    });

    expect(extractLocalSchemaReference(content)).toBeNull();
  });

  it("returns null when no $schema is present", () => {
    expect(extractLocalSchemaReference(JSON.stringify({ includes: [] }))).toBeNull();
  });

  it("returns null for JSON that is not an object", () => {
    expect(extractLocalSchemaReference("[]")).toBeNull();
    expect(extractLocalSchemaReference("42")).toBeNull();
  });

  it("returns null for unparseable content instead of throwing", () => {
    expect(extractLocalSchemaReference("{ not json")).toBeNull();
  });

  it("tolerates a leading UTF-8 BOM", () => {
    const content = `﻿${JSON.stringify({
      $schema: "/Users/me/phpactor.schema.json",
    })}`;

    expect(extractLocalSchemaReference(content)).toBe(
      "/Users/me/phpactor.schema.json",
    );
  });
});

describe("buildJsonSchemaRegistration", () => {
  it("parses the schema content and registers it under the raw $schema path and file:// URI plus a fileMatch", () => {
    const registration = buildJsonSchemaRegistration({
      documentPath: "/Users/me/project/.phpactor.json",
      schemaReference: "/Users/me/tools/phpactor/phpactor.schema.json",
      schemaContent: JSON.stringify({ type: "object" }),
    });

    expect(registration).not.toBeNull();
    const uris = registration!.schemas.map((entry) => entry.uri);
    expect(uris).toContain("/Users/me/tools/phpactor/phpactor.schema.json");
    expect(uris).toContain("file:///Users/me/tools/phpactor/phpactor.schema.json");
    for (const entry of registration!.schemas) {
      expect(entry.schema).toEqual({ type: "object" });
    }

    const fileMatches = registration!.schemas.flatMap(
      (entry) => entry.fileMatch ?? [],
    );
    expect(fileMatches.some((pattern) => pattern.includes(".phpactor.json"))).toBe(
      true,
    );
  });

  it("registers relative schema references under raw and document-relative URI candidates", () => {
    const registration = buildJsonSchemaRegistration({
      documentPath: "/Users/me/project/.phpactor.json",
      schemaReference: "./schemas/phpactor.schema.json",
      schemaContent: JSON.stringify({ type: "object" }),
    });

    expect(registration).not.toBeNull();
    const uris = registration!.schemas.map((entry) => entry.uri);
    expect(uris).toContain("./schemas/phpactor.schema.json");
    expect(uris).toContain("/Users/me/project/schemas/phpactor.schema.json");
    expect(uris).toContain(
      "file:///Users/me/project/schemas/phpactor.schema.json",
    );
  });

  it("returns null when the schema content is not valid JSON (graceful skip, never throws)", () => {
    const registration = buildJsonSchemaRegistration({
      documentPath: "/Users/me/project/.phpactor.json",
      schemaReference: "/Users/me/tools/phpactor/phpactor.schema.json",
      schemaContent: "{ broken",
    });

    expect(registration).toBeNull();
  });

  it("returns null when the parsed schema is not an object", () => {
    const registration = buildJsonSchemaRegistration({
      documentPath: "/Users/me/project/.phpactor.json",
      schemaReference: "/Users/me/tools/phpactor/phpactor.schema.json",
      schemaContent: "true",
    });

    expect(registration).toBeNull();
  });
});

describe("buildPlaceholderSchemaRegistration", () => {
  it("registers an empty (permissive) schema under the same candidate uris as a real one", () => {
    const registration = buildPlaceholderSchemaRegistration(
      "/Users/me/project/.phpactor.json",
      "/Users/me/tools/phpactor/phpactor.schema.json",
    );

    expect(registration).not.toBeNull();
    const uris = registration!.schemas.map((entry) => entry.uri);
    expect(uris).toContain("/Users/me/tools/phpactor/phpactor.schema.json");
    expect(uris).toContain("file:///Users/me/tools/phpactor/phpactor.schema.json");
    for (const entry of registration!.schemas) {
      expect(entry.schema).toEqual({});
    }
  });
});

describe("isSchemaReferenceRegistered", () => {
  it("is false before registration and true after merging the registration in", () => {
    const reference = "/Users/me/tools/phpactor.schema.json";
    const registration = buildJsonSchemaRegistration({
      documentPath: "/Users/me/project/.phpactor.json",
      schemaReference: reference,
      schemaContent: JSON.stringify({ type: "object" }),
    })!;
    const before = { validate: true, schemas: [] };

    expect(isSchemaReferenceRegistered(before, reference)).toBe(false);

    const after = mergeJsonSchemaIntoDiagnosticsOptions(before, registration);

    expect(isSchemaReferenceRegistered(after, reference)).toBe(true);
  });

  it("is false when only some of the candidate uris are present", () => {
    const reference = "/Users/me/tools/phpactor.schema.json";

    expect(
      isSchemaReferenceRegistered(
        { schemas: [{ uri: reference, schema: {} }] },
        reference,
      ),
    ).toBe(false);
  });

  it("checks document-relative schema candidates when the reference is relative", () => {
    const reference = "./schema.json";
    const documentPath = "/Users/me/project/.phpactor.json";
    const registration = buildJsonSchemaRegistration({
      documentPath,
      schemaReference: reference,
      schemaContent: JSON.stringify({ type: "object" }),
    })!;
    const options = mergeJsonSchemaIntoDiagnosticsOptions(
      { validate: true, schemas: [] },
      registration,
    );

    expect(isSchemaReferenceRegistered(options, reference, documentPath)).toBe(
      true,
    );
  });
});

describe("mergeJsonSchemaIntoDiagnosticsOptions", () => {
  it("enables validation and adds the new schema entries", () => {
    const registration = buildJsonSchemaRegistration({
      documentPath: "/Users/me/project/.phpactor.json",
      schemaReference: "/Users/me/tools/phpactor.schema.json",
      schemaContent: JSON.stringify({ type: "object" }),
    })!;

    const merged = mergeJsonSchemaIntoDiagnosticsOptions(
      { validate: true, schemas: [] },
      registration,
    );

    expect(merged.validate).toBe(true);
    expect(merged.schemas?.length).toBe(registration.schemas.length);
  });

  it("does not duplicate a schema that is already registered under the same uri (idempotent across reopens)", () => {
    const registration = buildJsonSchemaRegistration({
      documentPath: "/Users/me/project/.phpactor.json",
      schemaReference: "/Users/me/tools/phpactor.schema.json",
      schemaContent: JSON.stringify({ type: "object" }),
    })!;

    const once = mergeJsonSchemaIntoDiagnosticsOptions(
      { validate: true, schemas: [] },
      registration,
    );
    const twice = mergeJsonSchemaIntoDiagnosticsOptions(once, registration);

    expect(twice.schemas?.length).toBe(once.schemas?.length);
  });

  it("preserves schema entries already registered for other documents (per-workspace isolation, no clobbering)", () => {
    const existing = {
      validate: true,
      schemas: [
        {
          uri: "/other/package.json.schema",
          fileMatch: ["package.json"],
          schema: { type: "object" },
        },
      ],
    };
    const registration = buildJsonSchemaRegistration({
      documentPath: "/Users/me/project/.phpactor.json",
      schemaReference: "/Users/me/tools/phpactor.schema.json",
      schemaContent: JSON.stringify({ type: "object" }),
    })!;

    const merged = mergeJsonSchemaIntoDiagnosticsOptions(existing, registration);

    expect(
      merged.schemas?.some((entry) => entry.uri === "/other/package.json.schema"),
    ).toBe(true);
  });

  it("returns the same options reference when nothing changed (avoids a needless setDiagnosticsOptions call)", () => {
    const registration = buildJsonSchemaRegistration({
      documentPath: "/Users/me/project/.phpactor.json",
      schemaReference: "/Users/me/tools/phpactor.schema.json",
      schemaContent: JSON.stringify({ type: "object" }),
    })!;
    const once = mergeJsonSchemaIntoDiagnosticsOptions(
      { validate: true, schemas: [] },
      registration,
    );

    expect(mergeJsonSchemaIntoDiagnosticsOptions(once, registration)).toBe(once);
  });
});
