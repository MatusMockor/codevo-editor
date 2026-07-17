import type * as Monaco from "monaco-editor";
import {
  buildBundledJsonSchemaRegistration,
  buildJsonSchemaRegistration,
  buildPlaceholderSchemaRegistration,
  extractLocalSchemaReference,
  isSchemaReferenceRegistered,
  mergeJsonSchemaIntoDiagnosticsOptions,
  resolveLocalSchemaReferencePath,
  type JsonDiagnosticsOptionsLike,
  type JsonSchemaRegistration,
} from "../domain/jsonSchemaRegistration";

/**
 * The minimal shape of a document this loader needs. Keeping it structural
 * avoids a hard dependency on the editor document type and keeps the loader
 * trivially testable.
 */
export interface JsonSchemaDocument {
  path: string;
  content: string;
  language: string;
}

export interface JsonSchemaLoaderDependencies {
  /**
   * Reads a file's text from disk. In production this is the Tauri workspace
   * gateway's `readTextFile`; in tests it is a fake. This is the only external
   * (Tauri/filesystem) boundary the loader touches.
   */
  readTextFile(path: string): Promise<string>;
  /**
   * Returns `true` if the originally-requested workspace/document is no longer
   * the active one. Re-checked after the async file read so a project-tab switch
   * mid-read cannot leak one workspace's schema registration onto another.
   */
  isStale(): boolean;
  bundledSchemas?: BundledJsonSchema[];
}

export interface BundledJsonSchema {
  uri: string;
  fileMatch: string[];
  load(): Promise<unknown>;
}

export const BUNDLED_JSON_SCHEMAS: BundledJsonSchema[] = [
  {
    uri: "editor://schemas/composer.json",
    fileMatch: ["composer.json"],
    load: async () =>
      (await import("../assets/schemas/composer.schema.json")).default,
  },
  {
    uri: "editor://schemas/package.json",
    fileMatch: ["package.json"],
    load: async () =>
      (await import("../assets/schemas/package.schema.json")).default,
  },
  {
    uri: "editor://schemas/tsconfig.json",
    fileMatch: ["tsconfig.json", "tsconfig.*.json", "jsconfig.json"],
    load: async () =>
      (await import("../assets/schemas/tsconfig.schema.json")).default,
  },
];

/**
 * Loads the inline JSON Schema declared by a freshly opened JSON document and
 * registers it with Monaco so the document validates without the worker ever
 * trying to fetch the schema (which would yield the 768 "No schema request
 * service available" error).
 *
 * Safe to call for any document: it is a no-op unless the document is JSON and
 * declares a *local* `$schema` path.
 *
 * Whatever happens to the referenced schema file, the document's `$schema`
 * value still names a schema Monaco would otherwise try (and fail) to fetch,
 * producing the 768 error. So when the schema is readable we register its real
 * content; when it is missing or unparseable we register an empty placeholder
 * under the same id. Either way Monaco resolves the reference from its registry
 * and the 768 error never appears. A stale workspace still results in a silent
 * skip, and nothing is ever thrown.
 */
export async function loadJsonSchemaForDocument(
  monaco: typeof Monaco,
  document: JsonSchemaDocument,
  deps: JsonSchemaLoaderDependencies,
): Promise<void> {
  if (document.language !== "json") {
    return;
  }

  const schemaReference = extractLocalSchemaReference(document.content);

  const jsonDefaults = monaco.languages.json?.jsonDefaults;

  if (!jsonDefaults) {
    return;
  }

  if (!schemaReference) {
    await loadBundledJsonSchemaForDocument(jsonDefaults, document, deps);
    return;
  }

  const current = jsonDefaults.diagnosticsOptions as JsonDiagnosticsOptionsLike;

  // Already wired up (e.g. this effect re-fired on a keystroke in the same
  // document): skip before touching the disk so we never re-read the schema
  // file per character typed.
  if (isSchemaReferenceRegistered(current, schemaReference, document.path)) {
    return;
  }

  const schemaPath = resolveLocalSchemaReferencePath(
    document.path,
    schemaReference,
  );
  const schemaContent = await readSchemaContent(deps, schemaPath);

  // The workspace/document may have changed while the file was read; drop the
  // result rather than registering a schema for a tab the user already left.
  if (deps.isStale()) {
    return;
  }

  const registration = resolveRegistration(
    document.path,
    schemaReference,
    schemaContent,
  );

  if (!registration) {
    return;
  }

  // Re-read the live options after the await: another document may have
  // registered its schema while this read was in flight, and the merge must
  // build on the latest snapshot rather than the pre-await one.
  const latest = jsonDefaults.diagnosticsOptions as JsonDiagnosticsOptionsLike;
  const next = mergeJsonSchemaIntoDiagnosticsOptions(latest, registration);

  if (next === latest) {
    return;
  }

  jsonDefaults.setDiagnosticsOptions(
    next as Monaco.languages.json.DiagnosticsOptions,
  );
}

async function loadBundledJsonSchemaForDocument(
  jsonDefaults: typeof Monaco.languages.json.jsonDefaults,
  document: JsonSchemaDocument,
  deps: JsonSchemaLoaderDependencies,
): Promise<void> {
  const documentFileName = fileName(document.path);
  const bundledSchema = (deps.bundledSchemas ?? BUNDLED_JSON_SCHEMAS).find(
    (candidate) =>
      candidate.fileMatch.some((pattern) =>
        matchesFileNamePattern(pattern, documentFileName),
      ),
  );

  if (!bundledSchema) {
    return;
  }

  const current = jsonDefaults.diagnosticsOptions as JsonDiagnosticsOptionsLike;

  if (current.schemas?.some((entry) => entry.uri === bundledSchema.uri)) {
    return;
  }

  const schema = await loadBundledSchema(bundledSchema);

  if (!schema || deps.isStale()) {
    return;
  }

  const registration = buildBundledJsonSchemaRegistration({
    uri: bundledSchema.uri,
    fileMatch: bundledSchema.fileMatch,
    schema,
  });
  const latest = jsonDefaults.diagnosticsOptions as JsonDiagnosticsOptionsLike;
  const next = mergeJsonSchemaIntoDiagnosticsOptions(latest, registration);

  if (next === latest) {
    return;
  }

  jsonDefaults.setDiagnosticsOptions(
    next as Monaco.languages.json.DiagnosticsOptions,
  );
}

async function loadBundledSchema(
  bundledSchema: BundledJsonSchema,
): Promise<unknown | null> {
  try {
    return await bundledSchema.load();
  } catch {
    return null;
  }
}

function matchesFileNamePattern(pattern: string, name: string): boolean {
  if (!pattern.includes("*")) {
    return pattern === name;
  }

  const escaped = pattern
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");

  return new RegExp(`^${escaped}$`).test(name);
}

function fileName(path: string): string {
  const normalized = path.split("\\").join("/");
  const separator = normalized.lastIndexOf("/");

  if (separator < 0) {
    return normalized;
  }

  return normalized.slice(separator + 1);
}

async function readSchemaContent(
  deps: JsonSchemaLoaderDependencies,
  schemaReference: string,
): Promise<string | null> {
  try {
    return await deps.readTextFile(schemaReference);
  } catch {
    return null;
  }
}

/**
 * Picks the real-content registration when the schema parsed, falling back to a
 * permissive placeholder (which still suppresses the 768 fetch error) when the
 * schema file was missing or unparseable.
 */
function resolveRegistration(
  documentPath: string,
  schemaReference: string,
  schemaContent: string | null,
): JsonSchemaRegistration | null {
  const realRegistration =
    schemaContent === null
      ? null
      : buildJsonSchemaRegistration({
          documentPath,
          schemaReference,
          schemaContent,
        });

  if (realRegistration) {
    return realRegistration;
  }

  return buildPlaceholderSchemaRegistration(documentPath, schemaReference);
}
