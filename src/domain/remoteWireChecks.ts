export type WireCheck = (value: unknown) => boolean;

const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/u;
const LONE_SURROGATE = /[\ud800-\udfff]/u;
const TIMESTAMP =
  /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d{1,9})?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)$/u;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const RUNNER_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u;
const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

export const utf8Bytes = (value: string): number => new TextEncoder().encode(value).length;

export const hasControlCharacter = (value: string): boolean => CONTROL_CHARACTER.test(value);

export const isWellFormedText = (value: string): boolean => !LONE_SURROGATE.test(value);

export const isWireRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export const exactObject =
  (fields: Readonly<Record<string, WireCheck>>): WireCheck =>
  (value) =>
    isWireRecord(value) &&
    Object.keys(value).every((key) => Object.prototype.hasOwnProperty.call(fields, key)) &&
    Object.entries(fields).every(([key, check]) => check(value[key]));

export const oneOf =
  (...values: readonly unknown[]): WireCheck =>
  (value) =>
    values.includes(value);

export const nullable =
  (check: WireCheck): WireCheck =>
  (value) =>
    value === null || check(value);

export const optional =
  (check: WireCheck): WireCheck =>
  (value) =>
    value === undefined || check(value);

export const boundedArray =
  (check: WireCheck, max: number): WireCheck =>
  (value) =>
    Array.isArray(value) && value.length <= max && value.every(check);

export const integerIn =
  (min: number, max: number = Number.MAX_SAFE_INTEGER): WireCheck =>
  (value) =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;

export const isWireBoolean: WireCheck = (value) => typeof value === "boolean";

export const isWireUuid: WireCheck = (value) => typeof value === "string" && UUID_V4.test(value);

export const isRunnerIdentifier: WireCheck = (value) =>
  typeof value === "string" && RUNNER_IDENTIFIER.test(value);

export const isRunnerId: WireCheck = (value) =>
  typeof value === "string" &&
  value.trim().length > 0 &&
  utf8Bytes(value) <= 128 &&
  isWellFormedText(value) &&
  !hasControlCharacter(value);

export const isWireTimestamp: WireCheck = (value) =>
  typeof value === "string" && value.length <= 64 && TIMESTAMP.test(value);

export const isGitSha: WireCheck = (value) => typeof value === "string" && SHA.test(value);
