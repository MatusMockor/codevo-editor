/**
 * Pure helpers for wiring local JSON Schemas into Monaco's JSON language
 * service.
 *
 * Background / root cause
 * -----------------------
 * Monaco's JSON worker validates a document against the schema named by its
 * `$schema` property. When that value is a local disk path (absolute or
 * relative, e.g. `.phpactor.json` -> ".../phpactor.schema.json"), the worker
 * tries to *fetch* the schema through a "schema request service". The editor
 * never configures one (`enableSchemaRequest` defaults to `false`), so the
 * worker reports `SchemaResolveError` (code 768): "Unable to load schema from
 * '...'. No schema request service available". That surfaces as a yellow
 * squiggle + hover error on the `$schema` line.
 *
 * Fetching is also a dead end inside the Tauri webview: the JSON worker fetches
 * over http(s), and `file://` fetches do not work there. So instead of enabling
 * the request service we read the schema *content* ourselves (over the Tauri
 * file gateway) and hand it to Monaco *inline*. With an inline schema, the
 * worker resolves the `$schema` reference from its in-memory registry and never
 * calls the request service, so no 768 error is produced.
 *
 * Why several URIs per schema
 * ---------------------------
 * Monaco resolves a document's `$schema` by reading the property value, and -
 * because the value carries no URI scheme - resolving it relative to the
 * document resource before normalizing it with `URI.parse(...).toString()`.
 * Depending on how the model URI was built, the normalized id can be the raw
 * reference, the resolved POSIX path, or a `file://` URI. We register the same
 * schema content under every plausible id so the lookup hits regardless of
 * normalization. Registering the same content under multiple ids is harmless.
 *
 * This module is intentionally free of Monaco / Tauri imports so it can be unit
 * tested in isolation and reused by any call site.
 */

export interface JsonSchemaEntry {
  uri: string;
  fileMatch?: string[];
  schema: unknown;
}

export interface JsonDiagnosticsOptionsLike {
  validate?: boolean;
  schemas?: JsonSchemaEntry[];
  enableSchemaRequest?: boolean;
  [key: string]: unknown;
}

export interface JsonSchemaRegistration {
  /** The schema entries to merge into Monaco's JSON diagnostics options. */
  schemas: JsonSchemaEntry[];
}

interface BuildJsonSchemaRegistrationInput {
  /** Absolute path of the JSON document that declared the `$schema`. */
  documentPath: string;
  /** The local `$schema` value as written in the document (a disk path). */
  schemaReference: string;
  /** Raw text content read from the schema file on disk. */
  schemaContent: string;
}

const BOM = "﻿";

/**
 * Reads a JSON document's `$schema` and returns it only when it points at a
 * local disk path with no URI scheme. Remote (`http(s)://`) and
 * already-resolved (`file://`) references are not our concern: the former is
 * handled by a real schema store if/when one is added, the latter is already a
 * URI. Returns `null` for anything we cannot or should not load from disk.
 *
 * Never throws: malformed JSON yields `null` so callers can skip silently.
 */
export function extractLocalSchemaReference(content: string): string | null {
  const reference = readSchemaProperty(content);

  if (!reference) {
    return null;
  }

  if (hasUriScheme(reference)) {
    return null;
  }

  return reference;
}

function readSchemaProperty(content: string): string | null {
  const normalized = content.startsWith(BOM) ? content.slice(BOM.length) : content;

  const parsed = safeParseObject(normalized);

  if (!parsed) {
    return null;
  }

  const schema = parsed["$schema"];

  return typeof schema === "string" && schema.length > 0 ? schema : null;
}

/**
 * Matches a leading URI scheme such as `http:`, `https:`, or `file:`. Mirrors
 * the test Monaco's JSON worker uses to decide whether a `$schema` value is a
 * URI or a relative/absolute path.
 */
function hasUriScheme(value: string): boolean {
  return /^\w[\w\d+.-]*:/.test(value);
}

/**
 * Builds the inline schema registration for a single document, or `null` when
 * the schema content cannot be parsed into a JSON object. A non-object schema
 * (e.g. `true`, an array) is rejected so we never feed Monaco something it
 * cannot validate against.
 */
export function buildJsonSchemaRegistration(
  input: BuildJsonSchemaRegistrationInput,
): JsonSchemaRegistration | null {
  const schema = safeParseObject(input.schemaContent);

  if (!schema) {
    return null;
  }

  return buildRegistration(input.documentPath, input.schemaReference, schema);
}

/**
 * Builds a registration that maps the document's `$schema` reference to an
 * *empty* (permissive) schema. Used when the referenced schema file cannot be
 * read or parsed: the `$schema` value still exists in the document, so without
 * any registration Monaco's worker would try to fetch it and emit the 768
 * "No schema request service available" error. Registering an empty schema
 * under that id makes the worker resolve it from its registry instead - so the
 * error disappears and the document is simply not constrained by a real schema.
 *
 * Returns `null` only when the reference yields no usable id.
 */
export function buildPlaceholderSchemaRegistration(
  documentPath: string,
  schemaReference: string,
): JsonSchemaRegistration | null {
  return buildRegistration(documentPath, schemaReference, {});
}

function buildRegistration(
  documentPath: string,
  schemaReference: string,
  schema: unknown,
): JsonSchemaRegistration | null {
  const uris = candidateSchemaUris(schemaReference, documentPath);

  if (uris.length === 0) {
    return null;
  }

  const fileMatch = [fileMatchPatternFor(documentPath)];
  const schemas: JsonSchemaEntry[] = uris.map((uri) => ({
    uri,
    fileMatch,
    schema,
  }));

  return { schemas };
}

/**
 * Merges a registration into existing Monaco JSON diagnostics options without
 * clobbering schema entries registered for other documents/workspaces.
 *
 * - Validation is turned on (the whole point is to validate against the schema).
 * - Existing entries are preserved (per-workspace isolation: each open project's
 *   schemas coexist in the single global `jsonDefaults`).
 * - Entries whose `uri` already exists are skipped, so reopening the same file
 *   is idempotent and never grows the list unbounded.
 * - When nothing new would be added, the *same* options object is returned so
 *   the caller can cheaply detect "no change" and skip `setDiagnosticsOptions`.
 */
export function mergeJsonSchemaIntoDiagnosticsOptions(
  current: JsonDiagnosticsOptionsLike,
  registration: JsonSchemaRegistration,
): JsonDiagnosticsOptionsLike {
  const existing = current.schemas ?? [];
  const knownUris = new Set(existing.map((entry) => entry.uri));
  const additions = registration.schemas.filter(
    (entry) => !knownUris.has(entry.uri),
  );

  if (additions.length === 0) {
    return current;
  }

  return {
    ...current,
    validate: true,
    schemas: [...existing, ...additions],
  };
}

/**
 * The set of ids under which a schema is registered so Monaco's `$schema`
 * lookup is guaranteed to hit. Order does not matter; duplicates are removed.
 * Exported so callers can cheaply check whether a reference is already
 * registered before doing expensive work (e.g. a disk read).
 */
export function candidateSchemaUris(
  schemaReference: string,
  documentPath?: string,
): string[] {
  return candidateSchemaUrisForDocument(schemaReference, documentPath);
}

export function candidateSchemaUrisForDocument(
  schemaReference: string,
  documentPath?: string,
): string[] {
  const uris = new Set<string>();
  uris.add(schemaReference);
  const resolvedReference = documentPath
    ? resolveLocalSchemaReferencePath(documentPath, schemaReference)
    : schemaReference;
  uris.add(resolvedReference);

  if (resolvedReference.startsWith("/")) {
    uris.add(`file://${resolvedReference}`);
  }

  return [...uris];
}

export function resolveLocalSchemaReferencePath(
  documentPath: string,
  schemaReference: string,
): string {
  const normalizedReference = normalizePath(schemaReference);

  if (normalizedReference.startsWith("/")) {
    return normalizePathSegments(normalizedReference);
  }

  return normalizePathSegments(
    `${parentDirectory(normalizePath(documentPath))}/${normalizedReference}`,
  );
}

/**
 * Returns `true` when every candidate URI for the given `$schema` reference is
 * already present in the supplied diagnostics options. Lets a caller skip
 * re-reading the schema file (and re-registering) for a reference that is
 * already wired up - e.g. on every keystroke in an already-registered document.
 */
export function isSchemaReferenceRegistered(
  options: JsonDiagnosticsOptionsLike,
  schemaReference: string,
  documentPath?: string,
): boolean {
  const registered = new Set((options.schemas ?? []).map((entry) => entry.uri));

  return candidateSchemaUrisForDocument(schemaReference, documentPath).every(
    (uri) => registered.has(uri),
  );
}

/**
 * Builds a `fileMatch` glob that targets exactly this document. Monaco matches
 * `fileMatch` against the model URI, so a trailing-segment glob (`** /name`)
 * matches whatever scheme/prefix the URI ends up with.
 */
function fileMatchPatternFor(documentPath: string): string {
  const segments = documentPath.split("/");
  const fileName = segments[segments.length - 1] || documentPath;

  return `**/${fileName}`;
}

function parentDirectory(path: string): string {
  const index = path.lastIndexOf("/");

  if (index <= 0) {
    return path.startsWith("/") ? "/" : ".";
  }

  return path.slice(0, index);
}

function normalizePath(path: string): string {
  return path.split("\\").join("/");
}

function normalizePathSegments(path: string): string {
  const normalized = normalizePath(path);
  const absolute = normalized.startsWith("/");
  const parts: string[] = [];

  for (const part of normalized.split("/")) {
    if (!part || part === ".") {
      continue;
    }

    if (part === "..") {
      if (parts.length > 0 && parts[parts.length - 1] !== "..") {
        parts.pop();
        continue;
      }

      if (!absolute) {
        parts.push(part);
      }
      continue;
    }

    parts.push(part);
  }

  if (absolute) {
    return `/${parts.join("/")}`;
  }

  return parts.join("/") || ".";
}

function safeParseObject(content: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(content);

    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }

    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}
