declare const workspacePathBrand: unique symbol;

type BrandedString<Name extends string> = string & {
  readonly [workspacePathBrand]: Name;
};

export type WorkspacePathKey = BrandedString<"WorkspacePathKey">;
export type CanonicalNativePath = BrandedString<"CanonicalNativePath">;
export type CanonicalFileUri = BrandedString<"CanonicalFileUri">;
export type WorkspaceRelativePath = BrandedString<"WorkspaceRelativePath">;
export type WorkspaceMonacoUri = BrandedString<"WorkspaceMonacoUri">;

export type WorkspacePathUnicodeNormalization = "none" | "NFC" | "NFD";
export type WorkspacePathCaseFold = (normalizedValue: string) => string;

interface WorkspacePathPolicyBase {
  readonly unicodeNormalization: WorkspacePathUnicodeNormalization;
}

export interface CaseSensitiveWorkspacePathPolicy
  extends WorkspacePathPolicyBase {
  readonly caseSensitive: true;
}

export interface CaseInsensitiveWorkspacePathPolicy
  extends WorkspacePathPolicyBase {
  readonly caseSensitive: false;
  /** Filesystem-authoritative comparison transform, applied after normalization. */
  readonly foldCase: WorkspacePathCaseFold;
}

export type WorkspacePathPolicy =
  | CaseSensitiveWorkspacePathPolicy
  | CaseInsensitiveWorkspacePathPolicy;

export const DEFAULT_WORKSPACE_PATH_POLICY: CaseSensitiveWorkspacePathPolicy =
  Object.freeze({
    caseSensitive: true,
    unicodeNormalization: "none",
  });

export interface WorkspaceRootDescriptor {
  readonly workspaceId: string;
  readonly nativePath: CanonicalNativePath;
  readonly fileUri: CanonicalFileUri;
  readonly policy: WorkspacePathPolicy;
}

export interface WorkspacePath {
  readonly key: WorkspacePathKey;
  readonly nativePath: CanonicalNativePath;
  readonly fileUri: CanonicalFileUri;
  readonly relativePath: WorkspaceRelativePath;
  readonly monacoUri: WorkspaceMonacoUri;
}

export type WorkspacePathErrorCode =
  | "invalid-policy"
  | "invalid-unicode"
  | "invalid-workspace-id"
  | "malformed-uri"
  | "outside-workspace"
  | "unsupported-uri"
  | "unsafe-path";

export interface WorkspacePathError {
  readonly code: WorkspacePathErrorCode;
  readonly message: string;
}

export type WorkspacePathResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: WorkspacePathError };

/** Creates the immutable identity boundary for paths belonging to one workspace. */
export function createWorkspaceRoot(
  workspaceId: string,
  pathOrFileUri: string,
  policy: WorkspacePathPolicy = DEFAULT_WORKSPACE_PATH_POLICY,
): WorkspacePathResult<WorkspaceRootDescriptor> {
  const idError = validateWorkspaceId(workspaceId);

  if (idError) {
    return failure(idError.code, idError.message);
  }

  const policyError = validatePolicy(policy);

  if (policyError) {
    return failure(policyError.code, policyError.message);
  }

  const nativePathResult = canonicalNativePath(pathOrFileUri);

  if (!nativePathResult.ok) {
    return nativePathResult;
  }

  const nativePath = nativePathResult.value;
  const storedPolicy = storePolicy(policy);
  const storedPolicyError = validatePolicy(storedPolicy);

  if (storedPolicyError) {
    return failure(storedPolicyError.code, storedPolicyError.message);
  }

  return success(
    Object.freeze({
      workspaceId,
      nativePath,
      fileUri: fileUriFromNativePath(nativePath),
      policy: storedPolicy,
    }),
  );
}

/** Parses an absolute local path and scopes its identity to the supplied root. */
export function parseWorkspacePath(
  root: WorkspaceRootDescriptor,
  pathOrFileUri: string,
): WorkspacePathResult<WorkspacePath> {
  const nativePathResult = canonicalNativePath(pathOrFileUri);

  if (!nativePathResult.ok) {
    return nativePathResult;
  }

  const nativePath = nativePathResult.value;
  const rootSegments = pathSegments(root.nativePath);
  const candidateSegments = pathSegments(nativePath);
  const rootIdentityResult = identitySegments(rootSegments, root.policy);

  if (!rootIdentityResult.ok) {
    return rootIdentityResult;
  }

  const candidateIdentityResult = identitySegments(
    candidateSegments,
    root.policy,
  );

  if (!candidateIdentityResult.ok) {
    return candidateIdentityResult;
  }

  const rootIdentity = rootIdentityResult.value;
  const candidateIdentity = candidateIdentityResult.value;

  if (!containsSegments(rootIdentity, candidateIdentity)) {
    return failure(
      "outside-workspace",
      `Path is outside workspace root: ${nativePath}`,
    );
  }

  const relativeSegments = candidateSegments.slice(rootSegments.length);
  const relativeIdentity = candidateIdentity.slice(rootIdentity.length);
  const relativePath = relativeSegments.join("/") as WorkspaceRelativePath;

  return success(
    Object.freeze({
      key: JSON.stringify([
        root.workspaceId,
        ...relativeIdentity,
      ]) as WorkspacePathKey,
      nativePath,
      fileUri: fileUriFromNativePath(nativePath),
      relativePath,
      monacoUri: monacoUri(root.workspaceId, relativeIdentity),
    }),
  );
}

function canonicalNativePath(
  pathOrFileUri: string,
): WorkspacePathResult<CanonicalNativePath> {
  const inputError = validatePathString(pathOrFileUri);

  if (inputError) {
    return failure(inputError.code, inputError.message);
  }

  const pathResult = isUriLike(pathOrFileUri)
    ? nativePathFromFileUri(pathOrFileUri)
    : success(pathOrFileUri);

  if (!pathResult.ok) {
    return pathResult;
  }

  const path = pathResult.value;

  if (!path.startsWith("/")) {
    return failure(
      "unsafe-path",
      `Expected an absolute POSIX path: ${pathOrFileUri}`,
    );
  }

  const segments: string[] = [];

  for (const segment of path.split("/")) {
    if (!segment || segment === ".") {
      continue;
    }

    if (segment === "..") {
      if (segments.length === 0) {
        return failure(
          "unsafe-path",
          `Path traverses above filesystem root: ${pathOrFileUri}`,
        );
      }

      segments.pop();
      continue;
    }

    segments.push(segment);
  }

  return success(`/${segments.join("/")}` as CanonicalNativePath);
}

function nativePathFromFileUri(
  fileUri: string,
): WorkspacePathResult<string> {
  if (!fileUri.toLowerCase().startsWith("file:")) {
    return failure(
      "unsupported-uri",
      `Only local file URIs are supported: ${fileUri}`,
    );
  }

  if (fileUri.includes("?") || fileUri.includes("#") || fileUri.includes("\\")) {
    return failure(
      "malformed-uri",
      `File URI cannot contain query, fragment, or raw backslash: ${fileUri}`,
    );
  }

  const match = /^file:(?:\/\/([^/]*))?(\/.*)$/i.exec(fileUri);

  if (!match) {
    return failure("malformed-uri", `Malformed local file URI: ${fileUri}`);
  }

  const authority = match[1] ?? "";

  if (authority && authority.toLowerCase() !== "localhost") {
    return failure(
      "unsupported-uri",
      `Remote file URI authorities are not supported: ${fileUri}`,
    );
  }

  const decodedSegments: string[] = [];

  for (const segment of (match[2] ?? "").split("/")) {
    const decoded = decodeUriSegment(segment, fileUri);

    if (!decoded.ok) {
      return decoded;
    }

    decodedSegments.push(decoded.value);
  }

  return success(decodedSegments.join("/"));
}

function decodeUriSegment(
  segment: string,
  fileUri: string,
): WorkspacePathResult<string> {
  if (/%2f/i.test(segment)) {
    return failure(
      "unsafe-path",
      `Encoded path separators are not supported: ${fileUri}`,
    );
  }

  try {
    const decoded = decodeURIComponent(segment);
    const decodedError = validatePathString(decoded);

    if (decodedError) {
      return failure(decodedError.code, decodedError.message);
    }

    return success(decoded);
  } catch (error) {
    if (error instanceof URIError) {
      return failure(
        "malformed-uri",
        `Malformed percent encoding in file URI: ${fileUri}`,
      );
    }

    return failure("malformed-uri", `Unable to decode file URI: ${fileUri}`);
  }
}

function fileUriFromNativePath(path: CanonicalNativePath): CanonicalFileUri {
  const encodedPath = path
    .split("/")
    .map(encodeUriSegment)
    .join("/");

  return `file://${encodedPath}` as CanonicalFileUri;
}

function monacoUri(
  workspaceId: string,
  relativeIdentity: string[],
): WorkspaceMonacoUri {
  const encodedIdentity = [workspaceId, ...relativeIdentity]
    .map(base64UrlEncode)
    .join("/");

  return `workspace-file:/${encodedIdentity}` as WorkspaceMonacoUri;
}

function base64UrlEncode(value: string): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const bytes = new TextEncoder().encode(value);
  let encoded = "";

  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    const packed = (first << 16) | (second << 8) | third;

    encoded += alphabet[(packed >> 18) & 63];
    encoded += alphabet[(packed >> 12) & 63];

    if (index + 1 < bytes.length) {
      encoded += alphabet[(packed >> 6) & 63];
    }

    if (index + 2 < bytes.length) {
      encoded += alphabet[packed & 63];
    }
  }

  return encoded;
}

function encodeUriSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function identitySegments(
  segments: string[],
  policy: WorkspacePathPolicy,
): WorkspacePathResult<string[]> {
  const identity: string[] = [];

  for (const segment of segments) {
    const normalized =
      policy.unicodeNormalization === "none"
        ? segment
        : segment.normalize(policy.unicodeNormalization);

    if (policy.caseSensitive) {
      identity.push(normalized);
      continue;
    }

    let folded: string;

    try {
      folded = policy.foldCase(normalized);
    } catch {
      return failure("invalid-policy", "Workspace case fold failed");
    }

    const foldError = validateIdentityString(folded);

    if (foldError) {
      return failure(foldError.code, foldError.message);
    }

    identity.push(folded);
  }

  return success(identity);
}

function containsSegments(root: string[], candidate: string[]): boolean {
  if (candidate.length < root.length) {
    return false;
  }

  return root.every((segment, index) => segment === candidate[index]);
}

function pathSegments(path: CanonicalNativePath): string[] {
  return path === "/" ? [] : path.slice(1).split("/");
}

function isUriLike(value: string): boolean {
  return /^[A-Za-z][A-Za-z\d+.-]*:/.test(value);
}

function validateWorkspaceId(workspaceId: string): WorkspacePathError | null {
  if (!workspaceId) {
    return error("invalid-workspace-id", "Workspace ID must be non-empty");
  }

  const stringError = validateIdentityString(workspaceId);

  if (!stringError) {
    return null;
  }

  return error("invalid-workspace-id", stringError.message);
}

function validatePolicy(policy: WorkspacePathPolicy): WorkspacePathError | null {
  const validUnicodePolicy =
    policy.unicodeNormalization === "none" ||
    policy.unicodeNormalization === "NFC" ||
    policy.unicodeNormalization === "NFD";

  if (!validUnicodePolicy || typeof policy.caseSensitive !== "boolean") {
    return error(
      "invalid-policy",
      "Workspace path policy must define case and Unicode behavior",
    );
  }

  if (!policy.caseSensitive && typeof policy.foldCase !== "function") {
    return error(
      "invalid-policy",
      "Case-insensitive workspace policy requires an authoritative case fold",
    );
  }

  return null;
}

function storePolicy(policy: WorkspacePathPolicy): WorkspacePathPolicy {
  if (policy.caseSensitive) {
    return Object.freeze({
      caseSensitive: true,
      unicodeNormalization: policy.unicodeNormalization,
    });
  }

  return Object.freeze({
    caseSensitive: false,
    foldCase: policy.foldCase.bind(policy),
    unicodeNormalization: policy.unicodeNormalization,
  });
}

function validatePathString(value: string): WorkspacePathError | null {
  if (value.includes("\0")) {
    return error("unsafe-path", "Paths cannot contain NUL");
  }

  return validateWellFormedUnicode(value);
}

function validateIdentityString(value: unknown): WorkspacePathError | null {
  if (typeof value !== "string") {
    return error("invalid-policy", "Identity transforms must return a string");
  }

  if (value.includes("\0")) {
    return error("invalid-policy", "Identity strings cannot contain NUL");
  }

  return validateWellFormedUnicode(value);
}

function validateWellFormedUnicode(value: string): WorkspacePathError | null {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);

    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);

      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return error("invalid-unicode", "String contains an unpaired surrogate");
      }

      index += 1;
      continue;
    }

    if (code >= 0xdc00 && code <= 0xdfff) {
      return error("invalid-unicode", "String contains an unpaired surrogate");
    }
  }

  return null;
}

function success<Value>(value: Value): WorkspacePathResult<Value> {
  return { ok: true, value };
}

function failure<Value>(
  code: WorkspacePathErrorCode,
  message: string,
): WorkspacePathResult<Value> {
  return { ok: false, error: error(code, message) };
}

function error(
  code: WorkspacePathErrorCode,
  message: string,
): WorkspacePathError {
  return Object.freeze({ code, message });
}
