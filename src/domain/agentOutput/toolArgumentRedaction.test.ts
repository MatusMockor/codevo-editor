import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MAX_REDACTION_DEPTH,
  MAX_REDACTION_NODES,
  MAX_REDACTION_STRING_BYTES,
  SECRET_SEGMENT_MARKERS,
  SECRET_SUFFIX_MARKERS,
  argumentKeySegments,
  isSecretArgumentKey,
  redactToolArguments,
} from "./toolArgumentRedaction";

interface RedactionFixture {
  readonly segmentMarkers: ReadonlyArray<string>;
  readonly suffixMarkers: ReadonlyArray<string>;
  readonly maxDepth: number;
  readonly maxNodes: number;
  readonly maxStringBytes: number;
  readonly cases: ReadonlyArray<{
    readonly name: string;
    readonly input: unknown;
    readonly expected: unknown;
  }>;
}

const fixture = JSON.parse(
  readFileSync("src-tauri/tests/fixtures/codex_app_server/argument_redaction.json", "utf8"),
) as RedactionFixture;

describe("tool argument redaction", () => {
  it("shares its contract with the Rust projection fixture", () => {
    expect(SECRET_SEGMENT_MARKERS).toEqual(fixture.segmentMarkers);
    expect(SECRET_SUFFIX_MARKERS).toEqual(fixture.suffixMarkers);
    expect(MAX_REDACTION_DEPTH).toBe(fixture.maxDepth);
    expect(MAX_REDACTION_NODES).toBe(fixture.maxNodes);
    expect(MAX_REDACTION_STRING_BYTES).toBe(fixture.maxStringBytes);
  });

  it.each(fixture.cases.map((entry) => [entry.name, entry] as const))(
    "redacts the shared case: %s",
    (_name, entry) => {
      expect(redactToolArguments(entry.input).value).toEqual(entry.expected);
    },
  );

  it("reports node budget exhaustion", () => {
    expect(redactToolArguments(Array.from({ length: 1_000 }, (_, index) => index)).exhausted).toBe(
      true,
    );
    expect(redactToolArguments({ a: 1 }).exhausted).toBe(false);
  });

  it("splits keys into camel, snake, kebab, and dot segments", () => {
    expect(argumentKeySegments("X-Private_Key.v2")).toEqual(["x", "private", "key", "v2"]);
    expect(argumentKeySegments("OAuthToken")).toEqual(["o", "auth", "token"]);
    expect(argumentKeySegments("APIKey")).toEqual(["api", "key"]);
    expect(argumentKeySegments("--")).toEqual([]);
    expect(isSecretArgumentKey("")).toBe(false);
    expect(isSecretArgumentKey("clientSecret")).toBe(true);
  });
});
