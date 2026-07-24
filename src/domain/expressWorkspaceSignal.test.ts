import { describe, expect, it } from "vitest";
import { hasExpressWorkspaceSignal } from "./expressWorkspaceSignal";

describe("hasExpressWorkspaceSignal", () => {
  it("suppresses the panel when no express dependency and no route receivers exist", () => {
    expect(
      hasExpressWorkspaceSignal({
        manifest: {
          dependencies: { fastify: "^5.0.0" },
          devDependencies: { vitest: "^3.0.0" },
        },
        routes: [],
      }),
    ).toBe(false);
  });

  it.each(["dependencies", "devDependencies"] as const)("detects express in %s", (section) => {
    expect(
      hasExpressWorkspaceSignal({
        manifest: { [section]: { express: "^5.0.0" } },
        routes: [],
      }),
    ).toBe(true);
  });

  it("detects non-empty discovered routes without a manifest signal", () => {
    expect(hasExpressWorkspaceSignal({ manifest: null, routes: [{}] })).toBe(true);
  });

  it.each([
    null,
    [],
    { dependencies: [] },
    { dependencies: { express: 5 } },
    { devDependencies: { express: "" } },
    { dependencies: { express: "x".repeat(4_097) } },
  ])("fails closed for a malformed manifest %#", (manifest) => {
    expect(hasExpressWorkspaceSignal({ manifest, routes: [] })).toBe(false);
  });

  it("rejects dependency sections beyond the bounded entry limit", () => {
    const dependencies = Object.fromEntries(
      Array.from({ length: 4_097 }, (_, index) => [`package-${index}`, "^1.0.0"]),
    );
    dependencies.express = "^5.0.0";

    expect(hasExpressWorkspaceSignal({ manifest: { dependencies }, routes: [] })).toBe(false);
  });

  it("fails closed when malformed manifest properties cannot be read", () => {
    const manifest = Object.defineProperty({}, "dependencies", {
      get: () => {
        throw new Error("unreadable");
      },
    });

    expect(hasExpressWorkspaceSignal({ manifest, routes: [] })).toBe(false);
  });
});
