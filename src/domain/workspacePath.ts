import { isWellFormedUnicode } from "./unicodeText";

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
export type WorkspacePathFlavor = "posix" | "windows-drive" | "unc";

interface WorkspacePathPolicyBase {
  readonly unicodeNormalization: WorkspacePathUnicodeNormalization;
}

export interface CaseSensitiveWorkspacePathPolicy extends WorkspacePathPolicyBase {
  readonly caseSensitive: true;
}

export interface CaseInsensitiveWorkspacePathPolicy extends WorkspacePathPolicyBase {
  readonly caseSensitive: false;
  /** Filesystem-authoritative comparison transform, applied after normalization. */
  readonly foldCase: WorkspacePathCaseFold;
}

export type WorkspacePathPolicy =
  CaseSensitiveWorkspacePathPolicy | CaseInsensitiveWorkspacePathPolicy;

export const DEFAULT_WORKSPACE_PATH_POLICY: CaseSensitiveWorkspacePathPolicy = Object.freeze({
  caseSensitive: true,
  unicodeNormalization: "none",
});

const CONSERVATIVE_WINDOWS_WORKSPACE_PATH_POLICY: CaseInsensitiveWorkspacePathPolicy =
  Object.freeze({
    caseSensitive: false,
    foldCase: (value: string) => value.toLocaleLowerCase("en-US"),
    unicodeNormalization: "none",
  });

export interface WorkspaceRootDescriptor {
  readonly anchor: string;
  readonly flavor: WorkspacePathFlavor;
  readonly workspaceId: string;
  readonly nativePath: CanonicalNativePath;
  readonly fileUri: CanonicalFileUri;
  readonly policy: WorkspacePathPolicy;
}

export interface WorkspacePath {
  readonly anchor: string;
  readonly flavor: WorkspacePathFlavor;
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

  const nativePathResult = canonicalPath(pathOrFileUri);

  if (!nativePathResult.ok) {
    return nativePathResult;
  }

  const canonical = nativePathResult.value;
  const nativePath = canonical.nativePath;
  const storedPolicy = storePolicy(policy);
  const storedPolicyError = validatePolicy(storedPolicy);

  if (storedPolicyError) {
    return failure(storedPolicyError.code, storedPolicyError.message);
  }

  return success(
    Object.freeze({
      workspaceId,
      anchor: canonical.anchor,
      flavor: canonical.flavor,
      nativePath,
      fileUri: fileUriFromCanonicalPath(canonical),
      policy: storedPolicy,
    }),
  );
}

/** Creates a root whose stable identity is derived from its canonical path. */
export function createWorkspaceRootFromPath(
  pathOrFileUri: string,
  policy: WorkspacePathPolicy = DEFAULT_WORKSPACE_PATH_POLICY,
): WorkspacePathResult<WorkspaceRootDescriptor> {
  const canonicalRoot = createWorkspaceRoot("workspace-root", pathOrFileUri, policy);

  if (!canonicalRoot.ok) {
    return canonicalRoot;
  }

  return createWorkspaceRoot(
    canonicalRoot.value.nativePath,
    canonicalRoot.value.nativePath,
    policy,
  );
}

/**
 * Creates a path-derived root using portable platform defaults when no filesystem-authoritative
 * policy is available. POSIX remains case-sensitive; Windows drive and UNC paths use their
 * conservative case-insensitive identity while retaining exact drive/UNC anchor containment.
 */
export function createConservativeWorkspaceRootFromPath(
  pathOrFileUri: string,
): WorkspacePathResult<WorkspaceRootDescriptor> {
  const detected = createWorkspaceRootFromPath(pathOrFileUri);

  if (!detected.ok || detected.value.flavor === "posix") {
    return detected;
  }

  return createWorkspaceRootFromPath(
    pathOrFileUri,
    CONSERVATIVE_WINDOWS_WORKSPACE_PATH_POLICY,
  );
}

/** Parses an absolute local path and scopes its identity to the supplied root. */
export function parseWorkspacePath(
  root: WorkspaceRootDescriptor,
  pathOrFileUri: string,
): WorkspacePathResult<WorkspacePath> {
  const nativePathResult = canonicalPath(pathOrFileUri);

  if (!nativePathResult.ok) {
    return nativePathResult;
  }

  const candidate = nativePathResult.value;
  const nativePath = candidate.nativePath;
  if (candidate.flavor !== root.flavor) {
    return failure("outside-workspace", `Path is outside workspace root: ${nativePath}`);
  }
  const rootAnchorIdentity = identitySegments([root.anchor], root.policy);
  const candidateAnchorIdentity = identitySegments([candidate.anchor], root.policy);
  if (
    !rootAnchorIdentity.ok ||
    !candidateAnchorIdentity.ok ||
    rootAnchorIdentity.value[0] !== candidateAnchorIdentity.value[0]
  ) {
    return failure("outside-workspace", `Path is outside workspace root: ${nativePath}`);
  }
  const rootSegments = pathSegments(root.nativePath, root.flavor);
  const candidateSegments = candidate.segments;
  const rootIdentityResult = identitySegments(rootSegments, root.policy);

  if (!rootIdentityResult.ok) {
    return rootIdentityResult;
  }

  const candidateIdentityResult = identitySegments(candidateSegments, root.policy);

  if (!candidateIdentityResult.ok) {
    return candidateIdentityResult;
  }

  const rootIdentity = rootIdentityResult.value;
  const candidateIdentity = candidateIdentityResult.value;

  if (!containsSegments(rootIdentity, candidateIdentity)) {
    return failure("outside-workspace", `Path is outside workspace root: ${nativePath}`);
  }

  const relativeSegments = candidateSegments.slice(rootSegments.length);
  const relativeIdentity = candidateIdentity.slice(rootIdentity.length);
  const relativePath = relativeSegments.join("/") as WorkspaceRelativePath;

  return success(
    Object.freeze({
      key: JSON.stringify([
        root.workspaceId,
        root.flavor,
        rootAnchorIdentity.value[0],
        ...relativeIdentity,
      ]) as WorkspacePathKey,
      anchor: candidate.anchor,
      flavor: candidate.flavor,
      nativePath,
      fileUri: fileUriFromCanonicalPath(candidate),
      relativePath,
      monacoUri: monacoUri(root.workspaceId, [
        root.flavor,
        rootAnchorIdentity.value[0]!,
        ...relativeIdentity,
      ]),
    }),
  );
}

interface CanonicalPath {
  readonly anchor: string;
  readonly flavor: WorkspacePathFlavor;
  readonly nativePath: CanonicalNativePath;
  readonly segments: string[];
}

function canonicalPath(pathOrFileUri: string): WorkspacePathResult<CanonicalPath> {
  const inputError = validatePathString(pathOrFileUri);

  if (inputError) {
    return failure(inputError.code, inputError.message);
  }

  if (/^[A-Za-z]:[\\/]/.test(pathOrFileUri)) {
    return canonicalDrivePath(pathOrFileUri.split("\\").join("/"), pathOrFileUri);
  }
  if (/^\/[A-Za-z]:\//.test(pathOrFileUri)) {
    return canonicalDrivePath(pathOrFileUri.slice(1).split("\\").join("/"), pathOrFileUri);
  }
  if (/^\\\\/.test(pathOrFileUri)) {
    return canonicalUncPath(pathOrFileUri.split("\\").join("/"), pathOrFileUri);
  }
  if (/^\/\/[^/]/.test(pathOrFileUri)) {
    return canonicalUncPath(pathOrFileUri.split("\\").join("/"), pathOrFileUri);
  }
  return isUriLike(pathOrFileUri)
    ? canonicalPathFromFileUri(pathOrFileUri)
    : canonicalPosixPath(pathOrFileUri, pathOrFileUri);
}

function canonicalPathFromFileUri(fileUri: string): WorkspacePathResult<CanonicalPath> {
  if (!fileUri.toLowerCase().startsWith("file:")) {
    return failure("unsupported-uri", `Only local file URIs are supported: ${fileUri}`);
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
  const rawPath = match[2] ?? "";
  const hasUncAuthority = authority !== "" && authority.toLowerCase() !== "localhost";
  const flavor: WorkspacePathFlavor = hasUncAuthority
    ? "unc"
    : /^\/[A-Za-z]:\//.test(rawPath)
      ? "windows-drive"
      : "posix";

  if (hasUncAuthority && !safeAnchorSegment(authority)) {
    return failure("unsafe-path", `Unsafe UNC authority: ${fileUri}`);
  }

  const decodedSegments: string[] = [];

  for (const segment of rawPath.split("/")) {
    const decoded = decodeUriSegment(segment, fileUri, flavor);

    if (!decoded.ok) {
      return decoded;
    }

    decodedSegments.push(decoded.value);
  }

  const decodedPath = decodedSegments.join("/");
  if (flavor === "unc") {
    return canonicalUncPath(`//${authority}${decodedPath}`, fileUri);
  }
  if (flavor === "windows-drive") {
    return canonicalDrivePath(decodedPath.slice(1), fileUri);
  }
  return canonicalPosixPath(decodedPath, fileUri);
}

function canonicalPosixPath(path: string, source: string): WorkspacePathResult<CanonicalPath> {
  if (!path.startsWith("/") || path.startsWith("//")) {
    return failure("unsafe-path", `Expected an absolute POSIX path: ${source}`);
  }
  return canonicalFromParts("posix", "/", path.split("/").slice(1), source);
}

function canonicalDrivePath(path: string, source: string): WorkspacePathResult<CanonicalPath> {
  const match = /^([A-Za-z]:)\/(.*)$/.exec(path);
  if (!match) return failure("unsafe-path", `Malformed Windows drive path: ${source}`);
  return canonicalFromParts("windows-drive", match[1]!, match[2]!.split("/"), source);
}

function canonicalUncPath(path: string, source: string): WorkspacePathResult<CanonicalPath> {
  const parts = path.slice(2).split("/");
  const authority = parts.shift() ?? "";
  const share = parts.shift() ?? "";
  if (!safeAnchorSegment(authority) || !safeAnchorSegment(share)) {
    return failure("unsafe-path", `Malformed UNC anchor: ${source}`);
  }
  return canonicalFromParts("unc", `//${authority}/${share}`, parts, source);
}

function canonicalFromParts(
  flavor: WorkspacePathFlavor,
  anchor: string,
  rawSegments: string[],
  source: string,
): WorkspacePathResult<CanonicalPath> {
  const segments: string[] = [];
  for (const segment of rawSegments) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) {
        return failure("unsafe-path", `Path traverses above filesystem anchor: ${source}`);
      }
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  const nativePath = nativePathForParts(flavor, anchor, segments);
  return success({ anchor, flavor, nativePath, segments });
}

function safeAnchorSegment(value: string): boolean {
  return value !== "" && value !== "." && value !== ".." && !/[\\/%]/.test(value);
}

function decodeUriSegment(
  segment: string,
  fileUri: string,
  flavor: WorkspacePathFlavor,
): WorkspacePathResult<string> {
  if (/%2f/i.test(segment) || (flavor !== "posix" && /%5c/i.test(segment))) {
    return failure("unsafe-path", `Encoded path separators are not supported: ${fileUri}`);
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
      return failure("malformed-uri", `Malformed percent encoding in file URI: ${fileUri}`);
    }

    return failure("malformed-uri", `Unable to decode file URI: ${fileUri}`);
  }
}

function fileUriFromCanonicalPath(path: CanonicalPath): CanonicalFileUri {
  if (path.flavor === "unc") {
    const [authority, share] = path.anchor.slice(2).split("/");
    return `file://${authority}/${[share!, ...path.segments]
      .map(encodeUriSegment)
      .join("/")}` as CanonicalFileUri;
  }
  const encodedSegments = path.segments.map(encodeUriSegment).join("/");
  if (path.flavor === "windows-drive") {
    return `file:///${path.anchor}${encodedSegments ? `/${encodedSegments}` : "/"}` as CanonicalFileUri;
  }
  return `file:///${encodedSegments}` as CanonicalFileUri;
}

function nativePathForParts(
  flavor: WorkspacePathFlavor,
  anchor: string,
  segments: string[],
): CanonicalNativePath {
  if (flavor === "unc") {
    return `${anchor}${segments.length ? `/${segments.join("/")}` : ""}` as CanonicalNativePath;
  }
  if (flavor === "windows-drive") {
    return `/${anchor}${segments.length ? `/${segments.join("/")}` : "/"}` as CanonicalNativePath;
  }
  return `/${segments.join("/")}` as CanonicalNativePath;
}

function monacoUri(workspaceId: string, relativeIdentity: string[]): WorkspaceMonacoUri {
  const encodedIdentity = [workspaceId, ...relativeIdentity].map(base64UrlEncode).join("/");

  return `workspace-file:/${encodedIdentity}` as WorkspaceMonacoUri;
}

function base64UrlEncode(value: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
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
  return encodeURIComponent(segment).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
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

function pathSegments(path: CanonicalNativePath, flavor: WorkspacePathFlavor): string[] {
  if (flavor === "unc") return path.split("/").slice(4);
  if (flavor === "windows-drive") return path.split("/").slice(2);
  return path === "/" ? [] : path.split("/").slice(1);
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
    return error("invalid-policy", "Workspace path policy must define case and Unicode behavior");
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
  return isWellFormedUnicode(value)
    ? null
    : error("invalid-unicode", "String contains an unpaired surrogate");
}

function success<Value>(value: Value): WorkspacePathResult<Value> {
  return { ok: true, value };
}

function failure<Value>(code: WorkspacePathErrorCode, message: string): WorkspacePathResult<Value> {
  return { ok: false, error: error(code, message) };
}

function error(code: WorkspacePathErrorCode, message: string): WorkspacePathError {
  return Object.freeze({ code, message });
}
