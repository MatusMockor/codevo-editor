import { describe, expect, it } from "vitest";
import { compareAppUpdateVersions, parseAppVersion } from "./appVersionOrder";

describe("app version order", () => {
  it("orders numeric prerelease identifiers numerically, never as strings", () => {
    expect(compareAppUpdateVersions("0.2.0-beta.9", "0.2.0-beta.29")).toBeLessThan(0);
    expect(compareAppUpdateVersions("0.2.0-beta.29", "0.2.0-beta.9")).toBeGreaterThan(0);
    expect("0.2.0-beta.9" < "0.2.0-beta.29").toBe(false);
    expect(compareAppUpdateVersions("0.2.0-beta.20", "0.2.0-beta.29")).toBeLessThan(0);
    expect(compareAppUpdateVersions("0.2.0-beta.29", "0.2.0-beta.29")).toBe(0);
  });

  it("orders release components before prerelease precedence", () => {
    expect(compareAppUpdateVersions("0.1.9", "0.2.0")).toBeLessThan(0);
    expect(compareAppUpdateVersions("1.0.0", "0.9.9")).toBeGreaterThan(0);
    expect(compareAppUpdateVersions("0.2.0-beta.1", "0.2.0")).toBeLessThan(0);
    expect(compareAppUpdateVersions("0.2.0", "0.2.0-beta.1")).toBeGreaterThan(0);
    expect(compareAppUpdateVersions("0.2.0-alpha.2", "0.2.0-beta.1")).toBeLessThan(0);
    expect(compareAppUpdateVersions("0.2.0-beta", "0.2.0-beta.1")).toBeLessThan(0);
    expect(compareAppUpdateVersions("0.2.0-beta.1", "0.2.0-rc")).toBeLessThan(0);
  });

  it("ignores build metadata but keeps prerelease precedence", () => {
    expect(compareAppUpdateVersions("0.2.0+build.7", "0.2.0+build.1")).toBe(0);
    expect(compareAppUpdateVersions("0.2.0-beta.2+a", "0.2.0-beta.10+b")).toBeLessThan(0);
  });

  it("fails closed for versions it cannot order", () => {
    expect(compareAppUpdateVersions("0.2.0", "not-a-version")).toBeNull();
    expect(compareAppUpdateVersions(42, "0.2.0")).toBeNull();
    expect(parseAppVersion("0.2.0-beta.01")).toBeNull();
    expect(parseAppVersion("01.2.0")).toBeNull();
    expect(parseAppVersion("0.2")).toBeNull();
    expect(parseAppVersion(`0.2.0-${"a".repeat(80)}`)).toBeNull();
    expect(parseAppVersion("0.2.0-a.b.c.d.e.f.g.h.i")).toBeNull();
    expect(parseAppVersion("0.2.0-beta_1")).toBeNull();
  });

  it("parses a bounded release with trimmed input", () => {
    expect(parseAppVersion(" 0.2.0-beta.29 ")).toEqual({
      major: 0,
      minor: 2,
      patch: 0,
      prerelease: [
        { kind: "alphanumeric", value: "beta" },
        { kind: "numeric", value: 29 },
      ],
    });
  });
});
