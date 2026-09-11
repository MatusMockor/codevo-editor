import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const CONFIG_PATH = resolve(__dirname, "../../src-tauri/tauri.conf.json");

function contentSecurityPolicy(): string {
  const parsed: unknown = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  expect(parsed).toBeTypeOf("object");
  const csp = (parsed as { app?: { security?: { csp?: unknown } } }).app?.security?.csp;
  expect(csp).toBeTypeOf("string");
  return csp as string;
}

function directiveSources(policy: string, directive: string): ReadonlyArray<string> {
  const entry = policy
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${directive} `));
  expect(entry, `CSP declares ${directive}`).toBeDefined();
  return (entry as string).slice(directive.length).trim().split(/\s+/u);
}

describe("tauri content security policy", () => {
  it("allows images from object URLs so attachment thumbnails and transcript images render", () => {
    expect(directiveSources(contentSecurityPolicy(), "img-src")).toContain("blob:");
  });

  it("keeps scripts first-party only", () => {
    expect(directiveSources(contentSecurityPolicy(), "script-src")).toEqual(["'self'"]);
  });
});
