import { boundUtf8Text } from "./utf8Text";

export const SECRET_SEGMENT_MARKERS: ReadonlyArray<string> = [
  "auth",
  "authorization",
  "bearer",
  "cookie",
  "credential",
  "credentials",
  "dsn",
  "jwt",
  "passphrase",
  "passwd",
  "password",
  "pwd",
  "secret",
  "token",
];
export const SECRET_SUFFIX_MARKERS: ReadonlyArray<string> = [
  "accesskey",
  "accesstoken",
  "apikey",
  "authtoken",
  "clientsecret",
  "connectionstring",
  "privatekey",
  "refreshtoken",
  "secretkey",
  "sessionid",
];
export const MAX_REDACTION_DEPTH = 8;
export const MAX_REDACTION_NODES = 256;
export const MAX_REDACTION_STRING_BYTES = 1_024;

const REDACTED = "[redacted]";
const OMITTED = "\u2026";
const NAME_KEYS: ReadonlySet<string> = new Set(["name", "key", "header"]);
const VALUE_KEY = "value";
const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]*):[^\s@/]*@/giu;
const AUTH_SCHEME_TOKEN = /\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/giu;
const ALPHANUMERIC = /^[\p{L}\p{N}]$/u;
const ASCII_UPPER = /^[A-Z]$/u;
const ASCII_LOWER = /^[a-z]$/u;
const ASCII_DIGIT = /^[0-9]$/u;

export interface RedactedArguments {
  readonly value: unknown;
  readonly exhausted: boolean;
}

interface Budget {
  remaining: number;
}

export function redactToolArguments(value: unknown): RedactedArguments {
  const budget: Budget = { remaining: MAX_REDACTION_NODES };
  const redacted = redactValue(value, 0, budget);
  return { value: redacted, exhausted: budget.remaining === 0 };
}

export function argumentKeySegments(key: string): string[] {
  const characters = Array.from(key);
  const segments: string[] = [];
  let current = "";
  characters.forEach((character, index) => {
    if (!ALPHANUMERIC.test(character)) {
      if (current !== "") segments.push(current);
      current = "";
      return;
    }
    if (startsSegment(characters, index) && current !== "") {
      segments.push(current);
      current = "";
    }
    current += character.toLowerCase();
  });
  if (current !== "") segments.push(current);
  return segments;
}

function startsSegment(characters: ReadonlyArray<string>, index: number): boolean {
  const character = characters[index] ?? "";
  if (!ASCII_UPPER.test(character) || index === 0) return false;
  const previous = characters[index - 1] ?? "";
  if (ASCII_LOWER.test(previous) || ASCII_DIGIT.test(previous)) return true;
  return ASCII_UPPER.test(previous) && ASCII_LOWER.test(characters[index + 1] ?? "");
}

export function isSecretArgumentKey(key: string): boolean {
  const segments = argumentKeySegments(key);
  const last = segments[segments.length - 1];
  if (last === undefined) return false;
  if (SECRET_SEGMENT_MARKERS.includes(last)) return true;
  const joined = segments.join("");
  return SECRET_SUFFIX_MARKERS.some((marker) => joined.endsWith(marker));
}

function redactValue(value: unknown, depth: number, budget: Budget): unknown {
  if (budget.remaining === 0 || depth >= MAX_REDACTION_DEPTH) return OMITTED;
  budget.remaining -= 1;
  if (Array.isArray(value)) return redactArray(value, depth, budget);
  if (typeof value === "string") return maskSecrets(value);
  if (typeof value === "object" && value !== null)
    return redactObject(value as Record<string, unknown>, depth, budget);
  return value;
}

function redactArray(entries: ReadonlyArray<unknown>, depth: number, budget: Budget): unknown[] {
  const redacted: unknown[] = [];
  for (const entry of entries) {
    if (budget.remaining === 0) {
      redacted.push(OMITTED);
      break;
    }
    redacted.push(redactValue(entry, depth + 1, budget));
  }
  return redacted;
}

function redactObject(
  entries: Record<string, unknown>,
  depth: number,
  budget: Budget,
): Record<string, unknown> {
  const secretPair = namesASecret(entries);
  const redacted: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(entries)) {
    if (budget.remaining === 0) {
      redacted[OMITTED] = OMITTED;
      break;
    }
    if (
      isSecretArgumentKey(key) ||
      (secretPair && argumentKeySegments(key).join("") === VALUE_KEY)
    ) {
      redacted[key] = REDACTED;
      continue;
    }
    redacted[key] = redactValue(entry, depth + 1, budget);
  }
  return redacted;
}

function namesASecret(entries: Record<string, unknown>): boolean {
  return Object.entries(entries).some(
    ([key, entry]) =>
      NAME_KEYS.has(argumentKeySegments(key).join("")) &&
      typeof entry === "string" &&
      isSecretArgumentKey(entry),
  );
}

function maskSecrets(text: string): string {
  const bounded = boundUtf8Text(text, MAX_REDACTION_STRING_BYTES);
  const capped = bounded.clipped ? `${bounded.text}${OMITTED}` : bounded.text;
  return capped
    .replace(URL_CREDENTIALS, `$1:${REDACTED}@`)
    .replace(AUTH_SCHEME_TOKEN, `$1 ${REDACTED}`);
}
