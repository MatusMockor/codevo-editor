import { MAX_APP_UPDATE_VERSION_LENGTH } from "./appUpdater";

const MAX_APP_VERSION_PRERELEASE_IDENTIFIERS = 8;
const APP_VERSION_PATTERN =
  /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
const NUMERIC_IDENTIFIER_PATTERN = /^(0|[1-9]\d{0,8})$/;
const DIGITS_ONLY_PATTERN = /^\d+$/;
const ALPHANUMERIC_IDENTIFIER_PATTERN = /^[0-9A-Za-z-]+$/;

type AppVersionIdentifier =
  | { readonly kind: "numeric"; readonly value: number }
  | { readonly kind: "alphanumeric"; readonly value: string };

export interface AppVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: readonly AppVersionIdentifier[];
}

export function parseAppVersion(value: unknown): AppVersion | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > MAX_APP_UPDATE_VERSION_LENGTH) return null;
  const match = APP_VERSION_PATTERN.exec(normalized);
  if (match === null) return null;
  const prerelease = parsePrerelease(match[4]);
  if (prerelease === null) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease,
  };
}

export function compareAppVersions(left: AppVersion, right: AppVersion): number {
  if (left.major !== right.major) return left.major < right.major ? -1 : 1;
  if (left.minor !== right.minor) return left.minor < right.minor ? -1 : 1;
  if (left.patch !== right.patch) return left.patch < right.patch ? -1 : 1;
  return comparePrerelease(left.prerelease, right.prerelease);
}

export function compareAppUpdateVersions(left: unknown, right: unknown): number | null {
  const parsedLeft = parseAppVersion(left);
  if (parsedLeft === null) return null;
  const parsedRight = parseAppVersion(right);
  if (parsedRight === null) return null;
  return compareAppVersions(parsedLeft, parsedRight);
}

function parsePrerelease(raw: string | undefined): readonly AppVersionIdentifier[] | null {
  if (raw === undefined) return [];
  const parts = raw.split(".");
  if (parts.length > MAX_APP_VERSION_PRERELEASE_IDENTIFIERS) return null;
  const identifiers: AppVersionIdentifier[] = [];
  for (const part of parts) {
    const identifier = parseIdentifier(part);
    if (identifier === null) return null;
    identifiers.push(identifier);
  }
  return identifiers;
}

function parseIdentifier(part: string): AppVersionIdentifier | null {
  if (NUMERIC_IDENTIFIER_PATTERN.test(part)) return { kind: "numeric", value: Number(part) };
  if (DIGITS_ONLY_PATTERN.test(part)) return null;
  if (!ALPHANUMERIC_IDENTIFIER_PATTERN.test(part)) return null;
  return { kind: "alphanumeric", value: part };
}

function comparePrerelease(
  left: readonly AppVersionIdentifier[],
  right: readonly AppVersionIdentifier[],
): number {
  if (left.length === 0 && right.length === 0) return 0;
  if (left.length === 0) return 1;
  if (right.length === 0) return -1;
  const shared = Math.min(left.length, right.length);
  for (let index = 0; index < shared; index += 1) {
    const order = compareIdentifiers(left[index], right[index]);
    if (order !== 0) return order;
  }
  if (left.length === right.length) return 0;
  return left.length < right.length ? -1 : 1;
}

function compareIdentifiers(left: AppVersionIdentifier, right: AppVersionIdentifier): number {
  if (left.kind === "numeric" && right.kind === "numeric") {
    if (left.value === right.value) return 0;
    return left.value < right.value ? -1 : 1;
  }
  if (left.kind === "numeric") return -1;
  if (right.kind === "numeric") return 1;
  if (left.value === right.value) return 0;
  return left.value < right.value ? -1 : 1;
}
