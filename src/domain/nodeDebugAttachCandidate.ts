export const MAX_NODE_DEBUG_ATTACH_CANDIDATES = 128;
export const MAX_NODE_DEBUG_ATTACH_CANDIDATE_LABEL_BYTES = 32;
export const MAX_NODE_DEBUG_ATTACH_CANDIDATE_DETAIL_BYTES = 64;

const UTF8_ENCODER = new TextEncoder();
const CANDIDATE_LEASE_ID_PATTERN = /^[0-9a-f]{32}$/;
const DISPLAY_CONTROL_PATTERN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

/**
 * A deliberately redacted picker projection. Process identity, argv, image
 * paths, and inspector URLs remain backend-only and cannot enter this shape.
 *
 * Manual port entry is a separate attach flow and is not represented here.
 */
export interface NodeDebugAttachCandidate {
  readonly candidateLeaseId: string;
  readonly label: string;
  readonly detail: string;
  readonly port: number;
}

export type NodeDebugAttachCandidateListResult =
  | {
      readonly status: "ok";
      readonly candidates: readonly NodeDebugAttachCandidate[];
      readonly truncated: boolean;
    }
  | {
      readonly status: "unavailable";
    }
  | {
      readonly status: "error";
    };

/**
 * Decodes only endpoint-validated, leased picker values. This function does not
 * authorize publishing unverified process inventory.
 */
export function decodeNodeDebugAttachCandidateListResult(
  value: unknown,
): NodeDebugAttachCandidateListResult {
  const result = record(value, "result");
  const status = result.status;
  if (status === "unavailable" || status === "error") {
    exactKeys(result, ["status"], "result");
    return Object.freeze({ status });
  }
  if (status !== "ok") invalid("result.status", "ok, unavailable, or error");

  exactKeys(result, ["status", "candidates", "truncated"], "result");
  const candidateValues = densePlainArray(
    result.candidates,
    "result.candidates",
    MAX_NODE_DEBUG_ATTACH_CANDIDATES,
  );

  const leaseIds = new Set<string>();
  const candidates = candidateValues.map((candidate, index) => {
    const parsed = decodeCandidate(candidate, `result.candidates[${index}]`);
    if (leaseIds.has(parsed.candidateLeaseId)) {
      invalid("result.candidates", "candidates with unique lease IDs");
    }
    leaseIds.add(parsed.candidateLeaseId);
    return parsed;
  });

  return Object.freeze({
    status,
    candidates: Object.freeze(candidates),
    truncated: strictBoolean(result.truncated, "result.truncated"),
  });
}

export function isNodeDebugAttachCandidate(value: unknown): value is NodeDebugAttachCandidate {
  try {
    decodeCandidate(value, "candidate");
    return true;
  } catch {
    return false;
  }
}

export function isNodeDebugAttachCandidateLeaseId(value: unknown): value is string {
  return typeof value === "string" && value.length === 32 && CANDIDATE_LEASE_ID_PATTERN.test(value);
}

export function isSafeNodeDebugAttachPort(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= 65_535;
}

function decodeCandidate(value: unknown, path: string): NodeDebugAttachCandidate {
  const candidate = record(value, path);
  exactKeys(candidate, ["candidateLeaseId", "label", "detail", "port"], path);
  const { candidateLeaseId, detail, label, port } = candidate;
  if (!isNodeDebugAttachCandidateLeaseId(candidateLeaseId)) {
    invalid(`${path}.candidateLeaseId`, "exactly 32 lowercase hexadecimal characters");
  }
  if (!isSafeNodeDebugAttachPort(port)) {
    invalid(`${path}.port`, "an integer from 1 through 65535");
  }

  return Object.freeze({
    candidateLeaseId,
    label: displayText(label, `${path}.label`, MAX_NODE_DEBUG_ATTACH_CANDIDATE_LABEL_BYTES),
    detail: displayText(detail, `${path}.detail`, MAX_NODE_DEBUG_ATTACH_CANDIDATE_DETAIL_BYTES),
    port,
  });
}

function displayText(value: unknown, path: string, maximumBytes: number): string {
  if (
    typeof value !== "string" ||
    value.length > maximumBytes ||
    value.trim() === "" ||
    !isWellFormedUnicode(value) ||
    DISPLAY_CONTROL_PATTERN.test(value) ||
    UTF8_ENCODER.encode(value).byteLength > maximumBytes
  ) {
    invalid(
      path,
      `a non-empty, well-formed, control-free UTF-8 string of at most ${maximumBytes} bytes`,
    );
  }
  return value;
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function strictBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") invalid(path, "a boolean");
  return value;
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid(path, "an object");
  }
  let prototype: object | null;
  let keys: readonly PropertyKey[];
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    invalid(path, "a plain object with inspectable own fields");
  }
  if (prototype !== Object.prototype && prototype !== null) {
    invalid(path, "a plain object");
  }

  const snapshot = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    if (typeof key !== "string") {
      invalid(path, "string-named own fields only");
    }
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      invalid(path, "inspectable own data fields");
    }
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
      invalid(`${path}.${key}`, "an enumerable own data field");
    }
    snapshot[key] = descriptor.value;
  }
  return snapshot;
}

function densePlainArray(value: unknown, path: string, maximumLength: number): unknown[] {
  if (!Array.isArray(value)) {
    invalid(path, `an array of at most ${maximumLength} candidates`);
  }
  let prototype: object | null;
  let lengthDescriptor: PropertyDescriptor | undefined;
  try {
    prototype = Object.getPrototypeOf(value);
    lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  } catch {
    invalid(path, "a plain array with inspectable entries");
  }
  if (prototype !== Array.prototype) invalid(path, "a plain array");
  if (
    !lengthDescriptor ||
    !("value" in lengthDescriptor) ||
    typeof lengthDescriptor.value !== "number" ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0 ||
    lengthDescriptor.value > maximumLength
  ) {
    invalid(path, `an array of at most ${maximumLength} candidates`);
  }
  const length = lengthDescriptor.value;
  let keys: readonly PropertyKey[];
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    invalid(path, "a plain array with inspectable entries");
  }
  if (
    keys.length !== length + 1 ||
    keys.some(
      (key) =>
        typeof key !== "string" || (key !== "length" && !arrayIndexWithinLength(key, length)),
    )
  ) {
    invalid(path, "a dense array without extra fields");
  }

  const snapshot: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    } catch {
      invalid(path, "inspectable own data entries");
    }
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
      invalid(`${path}[${index}]`, "an enumerable own data entry");
    }
    snapshot.push(descriptor.value);
  }
  return snapshot;
}

function arrayIndexWithinLength(key: string, length: number): boolean {
  if (!/^(?:0|[1-9]\d*)$/.test(key)) return false;
  const index = Number(key);
  return Number.isSafeInteger(index) && index >= 0 && index < length && String(index) === key;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  path: string,
): void {
  const keys = Object.keys(value);
  if (keys.length !== expected.length || keys.some((key) => !expected.includes(key))) {
    invalid(path, `exactly the fields ${expected.join(", ")}`);
  }
}

function invalid(path: string, expected: string): never {
  throw new TypeError(
    `Invalid Node debug attach candidate value at ${path}: expected ${expected}.`,
  );
}
