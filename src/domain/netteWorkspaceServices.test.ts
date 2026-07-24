import { describe, expect, it } from "vitest";
import {
  projectNetteWorkspaceServices,
  resolveNetteWorkspaceServiceOverlayPath,
  type NetteWorkspaceServicesResult,
} from "./netteWorkspaceServices";

const ROOT = "/workspace";

function ok(result: NetteWorkspaceServicesResult) {
  expect(result.status).toBe("ok");

  if (result.status !== "ok") {
    throw new Error(result.message);
  }

  return result;
}

describe("projectNetteWorkspaceServices", () => {
  it("rejects overlay paths containing dot segments or escaping the root", () => {
    expect(resolveNetteWorkspaceServiceOverlayPath("/workspace", "../outside.neon")).toBeNull();
    expect(
      resolveNetteWorkspaceServiceOverlayPath("/workspace", "/workspace/../outside.neon"),
    ).toBeNull();
    expect(resolveNetteWorkspaceServiceOverlayPath("/workspace", "./config/a.neon")).toBeNull();
    expect(resolveNetteWorkspaceServiceOverlayPath("/workspace", "config/a.neon")).toBe(
      "/workspace/config/a.neon",
    );
  });
  it("keeps the first definition in merge precedence and preserves source anchors", () => {
    const override = [
      "services:",
      "    mailer: App\\OverrideMailer",
      "    logger: App\\Logger",
    ].join("\n");
    const base = ["services:", "    mailer: App\\BaseMailer", "    cache: App\\Cache"].join("\n");
    const result = ok(
      projectNetteWorkspaceServices(ROOT, [
        { path: `${ROOT}/config/override.neon`, source: override },
        { path: `${ROOT}/config/base.neon`, source: base },
      ]),
    );

    expect(result.services.map(({ id, className }) => ({ id, className }))).toEqual([
      { id: "mailer", className: "App\\OverrideMailer" },
      { id: "logger", className: "App\\Logger" },
      { id: "cache", className: "App\\Cache" },
    ]);
    expect(result.services[0]?.source).toEqual({
      path: `${ROOT}/config/override.neon`,
      lineNumber: 2,
      column: 5,
    });
    expect(new Set(result.services.map((service) => service.key)).size).toBe(
      result.services.length,
    );
  });

  it("resolves alias chains to their concrete type and autowiring policy", () => {
    const source = [
      "services:",
      "    repository:",
      "        class: App\\Repository",
      "        autowired: false",
      "    publicRepository: @repository",
      "    legacyRepository: @publicRepository",
    ].join("\n");
    const result = ok(
      projectNetteWorkspaceServices(ROOT, [{ path: `${ROOT}/config/services.neon`, source }]),
    );

    expect(result.services).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "publicRepository",
          alias: "repository",
          className: "App\\Repository",
          autowired: false,
        }),
        expect.objectContaining({
          id: "legacyRepository",
          alias: "publicRepository",
          className: "App\\Repository",
          autowired: false,
        }),
      ]),
    );
  });

  it("handles conflicting aliases deterministically and leaves cycles unresolved", () => {
    const first = [
      "services:",
      "    target: App\\Target",
      "    public: @target",
      "    cycleA: @cycleB",
      "    cycleB: @cycleA",
    ].join("\n");
    const second = "services:\n    public: @App\\OtherTarget";
    const result = ok(
      projectNetteWorkspaceServices(ROOT, [
        { path: `${ROOT}/config/first.neon`, source: first },
        { path: `${ROOT}/config/second.neon`, source: second },
      ]),
    );

    expect(result.services.find((service) => service.id === "public")).toEqual(
      expect.objectContaining({ alias: "target", className: "App\\Target" }),
    );
    expect(result.services.find((service) => service.id === "cycleA")).toEqual(
      expect.objectContaining({ alias: "cycleB", className: null }),
    );
  });

  it("assigns stable generated ids to anonymous services across files", () => {
    const result = ok(
      projectNetteWorkspaceServices(ROOT, [
        {
          path: `${ROOT}/config/first.neon`,
          source: "services:\n    - App\\First\n    named: App\\Named",
        },
        {
          path: `${ROOT}/config/second.neon`,
          source: "services:\n    - App\\Second",
        },
      ]),
    );

    expect(result.services.map(({ id, className }) => [id, className])).toEqual([
      ["01", "App\\First"],
      ["named", "App\\Named"],
      ["02", "App\\Second"],
    ]);
  });

  it("keeps generated ids unique when a configuration reserves a numeric id", () => {
    const result = ok(
      projectNetteWorkspaceServices(ROOT, [
        {
          path: `${ROOT}/config/services.neon`,
          source: "services:\n    01: App\\Reserved\n    - App\\Anonymous",
        },
      ]),
    );

    expect(result.services.map((service) => service.id)).toEqual(["01", "02"]);
  });

  it("replaces a discovered source with its dirty overlay without changing order", () => {
    const path = `${ROOT}/config/services.neon`;
    const result = ok(
      projectNetteWorkspaceServices(
        ROOT,
        [{ path, source: "services:\n    mailer: App\\DiskMailer" }],
        [
          { path: "config/services.neon", source: "services:\n    mailer: App\\DirtyMailer" },
          { path: "/outside/injected.neon", source: "services:\n    bad: App\\Bad" },
        ],
      ),
    );

    expect(result.services).toEqual([
      expect.objectContaining({ id: "mailer", className: "App\\DirtyMailer" }),
    ]);
  });

  it("reports total and truncation independently from the bounded result", () => {
    const result = ok(
      projectNetteWorkspaceServices(
        ROOT,
        [
          {
            path: `${ROOT}/config/services.neon`,
            source: [
              "services:",
              "    first: App\\First",
              "    second: App\\Second",
              "    third: App\\Third",
            ].join("\n"),
          },
        ],
        [],
        { maxServices: 2 },
      ),
    );

    expect(result.services.map((service) => service.id)).toEqual(["first", "second"]);
    expect(result.total).toBe(3);
    expect(result.truncated).toBe(true);
  });

  it("returns a tagged unavailable result without a workspace", () => {
    expect(projectNetteWorkspaceServices("", [])).toEqual({
      status: "unavailable",
      message: "No workspace is open.",
    });
  });
});
