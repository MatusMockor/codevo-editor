import { describe, expect, it, vi } from "vitest";
import {
  NEON_CROSS_FILE_MAX_FILES,
  neonCrossFileSymbolFactsAt,
  planNeonCrossFileSymbolRename,
  snapshotNeonCrossFileRepository,
  type NeonCrossFileRepository,
} from "./neonCrossFileSymbolSweep";

const ROOT = "/ws";

describe("cross-file NEON symbol sweep", () => {
  it("finds deterministic declarations and references through sibling, reverse, and cyclic includes", async () => {
    const files = {
      "/ws/config/config.neon": "includes:\n  - services\n  - consumers\n",
      "/ws/config/consumers.neon":
        "includes:\n  - config\nservices:\n  consumer: App\\Consumer(@mailer)\n",
      "/ws/config/services.neon": "services:\n  mailer: App\\Mailer\n",
    };
    const snapshot = await snapshotNeonCrossFileRepository(
      repository(files, "/ws/config/consumers.neon"),
    );
    const source = files["/ws/config/consumers.neon"];
    const facts = neonCrossFileSymbolFactsAt(snapshot, source.lastIndexOf("mailer") + 2);

    expect(snapshot.status).toBe("complete");
    expect(snapshot.component.map(({ path }) => path)).toEqual([
      "/ws/config/config.neon",
      "/ws/config/consumers.neon",
      "/ws/config/services.neon",
    ]);
    expect(facts).toMatchObject({ declarationCount: 1, status: "complete" });
    expect(facts?.occurrences.map(({ declaration, path }) => ({ declaration, path }))).toEqual([
      { declaration: false, path: "/ws/config/consumers.neon" },
      { declaration: true, path: "/ws/config/services.neon" },
    ]);
  });

  it("plans aliases, setup references, and service-method factories without class edits", async () => {
    const files = {
      "/ws/config/config.neon": "includes:\n  - services\n  - wiring\n",
      "/ws/config/services.neon": "services:\n  mailer: App\\Mail\\Mailer\n",
      "/ws/config/wiring.neon": [
        "services:",
        "  publicMailer: @mailer",
        "  consumer:",
        "    factory: @mailer::create",
        "    setup:",
        "      - setMailer(@mailer)",
        "  typed: App\\Mail\\Mailer",
      ].join("\n"),
    };
    const activePath = "/ws/config/wiring.neon";
    const snapshot = await snapshotNeonCrossFileRepository(repository(files, activePath));
    const offset = files[activePath].indexOf("@mailer") + 2;
    const plan = planNeonCrossFileSymbolRename(snapshot, offset, "primaryMailer");

    expect(plan.kind).toBe("ready");
    if (plan.kind !== "ready") return;
    expect(plan.edits).toHaveLength(4);
    expect(plan.edits.map(({ newText }) => newText)).toEqual([
      "primaryMailer",
      "primaryMailer",
      "primaryMailer",
      "primaryMailer",
    ]);
    expect(
      plan.edits.some(({ path, span }) =>
        files[path as keyof typeof files].slice(span.start, span.end).includes("App"),
      ),
    ).toBe(false);
  });

  it("renames only a dotted parameter leaf across files", async () => {
    const files = {
      "/ws/config/config.neon": "includes:\n  - parameters\n  - services\n",
      "/ws/config/parameters.neon": "parameters:\n  mail:\n    host: localhost\n",
      "/ws/config/services.neon": "services:\n  mailer: App\\Mailer(%mail.host%)\n",
    };
    const activePath = "/ws/config/services.neon";
    const snapshot = await snapshotNeonCrossFileRepository(repository(files, activePath));
    const offset = files[activePath].indexOf("mail.host") + 2;
    const plan = planNeonCrossFileSymbolRename(snapshot, offset, "mail.server");

    expect(plan.kind).toBe("ready");
    if (plan.kind !== "ready") return;
    expect(plan.edits.map(({ newText }) => newText)).toEqual(["server", "mail.server"]);
    expect(planNeonCrossFileSymbolRename(snapshot, offset, "smtp.host")).toEqual({
      kind: "rejected",
      reason: "invalidName",
    });
  });

  it("rejects duplicate declarations and destination collisions", async () => {
    const duplicate = {
      "/ws/config/config.neon": "includes:\n  - one\n  - two\n",
      "/ws/config/one.neon": "services:\n  mailer: App\\One\n",
      "/ws/config/two.neon": "services:\n  mailer: App\\Two\n",
    };
    const duplicateSnapshot = await snapshotNeonCrossFileRepository(
      repository(duplicate, "/ws/config/one.neon"),
    );
    expect(
      planNeonCrossFileSymbolRename(
        duplicateSnapshot,
        duplicate["/ws/config/one.neon"].indexOf("mailer") + 1,
        "renamed",
      ),
    ).toEqual({
      kind: "rejected",
      reason: "ambiguousDeclaration",
    });

    const collision = {
      ...duplicate,
      "/ws/config/two.neon": "services:\n  primaryMailer: App\\Two\n",
    };
    const collisionSnapshot = await snapshotNeonCrossFileRepository(
      repository(collision, "/ws/config/one.neon"),
    );
    expect(
      planNeonCrossFileSymbolRename(
        collisionSnapshot,
        collision["/ws/config/one.neon"].indexOf("mailer") + 1,
        "primaryMailer",
      ),
    ).toEqual({
      kind: "rejected",
      reason: "destinationCollision",
    });
  });

  it("uses open overlays instead of disk and ignores dynamic/class/include tokens", async () => {
    const activePath = "/ws/config/services.neon";
    const files = {
      "/ws/config/config.neon": "includes:\n  - services\n  - wiring\n",
      [activePath]: "services:\n  old: App\\Old\n",
      "/ws/config/wiring.neon": "services:\n  x: App\\X(@mailer)\n",
    };
    const overlay = "services:\n  mailer: App\\Mailer\n  dynamic: %factory%\n";
    const snapshot = await snapshotNeonCrossFileRepository({
      ...repository(files, activePath),
      openOverlays: new Map([[activePath, overlay]]),
    });
    const plan = planNeonCrossFileSymbolRename(snapshot, overlay.indexOf("mailer") + 1, "renamed");
    expect(plan.kind).toBe("ready");
    const active = snapshot.documents.find(({ path }) => path === activePath);
    expect(active?.source).toBe(overlay);
    expect(neonCrossFileSymbolFactsAt(snapshot, overlay.indexOf("App\\Mailer") + 2)).toBeNull();
    expect(
      planNeonCrossFileSymbolRename(snapshot, overlay.indexOf("%factory%") + 2, "maker"),
    ).toEqual({ kind: "rejected", reason: "ambiguousDeclaration" });
    const config = snapshot.documents.find(({ path }) => path.endsWith("config.neon"));
    expect(
      config &&
        neonCrossFileSymbolFactsAt(
          { ...snapshot, activePath: config.path },
          config.source.indexOf("services") + 1,
        ),
    ).toBeNull();
  });

  it("matches Windows overlays and deduplicates listed paths case-insensitively", async () => {
    const activePath = "C:\\Workspace\\config\\services.neon";
    const overlay = "services:\n  mailer: App\\OverlayMailer\n";
    const snapshot = await snapshotNeonCrossFileRepository({
      activePath,
      rootPath: "C:\\Workspace",
      openOverlays: new Map([["c:/workspace/CONFIG/SERVICES.neon", overlay]]),
      listNeonFiles: async () => [
        "C:/Workspace/config/services.neon",
        "c:/workspace/CONFIG/SERVICES.neon",
      ],
      readFile: async () => "services:\n  disk: App\\DiskMailer\n",
    });

    expect(snapshot.status).toBe("complete");
    expect(snapshot.documents).toHaveLength(1);
    expect(snapshot.documents[0]?.source).toBe(overlay);
    expect(snapshot.component).toEqual(snapshot.documents);
  });

  it("preserves UNC roots case-insensitively and rejects traversal above the share", async () => {
    const activePath = "\\\\server\\share\\config\\services.neon";
    const snapshot = await snapshotNeonCrossFileRepository({
      activePath,
      rootPath: "\\\\Server\\Share",
      listNeonFiles: async () => ["\\\\SERVER\\SHARE\\CONFIG\\SERVICES.NEON"],
      readFile: async () => "services:\n  mailer: App\\Mailer\n",
    });
    expect(snapshot.status).toBe("complete");
    expect(snapshot.documents).toHaveLength(1);
    expect(snapshot.rootPath).toBe("//Server/Share");

    const escaping = await snapshotNeonCrossFileRepository({
      activePath,
      rootPath: "\\\\Server\\Share",
      listNeonFiles: async () => [],
      readFile: async () => "includes:\n  - ../../../outside.neon\n",
    });
    expect(escaping.incompleteReasons).toContain("includeOutsideRoot");
  });

  it("deep-freezes selected spans exposed by facts and rename plans", async () => {
    const files = { "/ws/services.neon": "services:\n  mailer: App\\Mailer\n" };
    const source = files["/ws/services.neon"];
    const snapshot = await snapshotNeonCrossFileRepository(repository(files, "/ws/services.neon"));
    const facts = neonCrossFileSymbolFactsAt(snapshot, source.indexOf("mailer") + 1);
    const plan = planNeonCrossFileSymbolRename(snapshot, source.indexOf("mailer") + 1, "renamed");

    expect(Object.isFrozen(facts?.selectedSpan)).toBe(true);
    expect(plan.kind).toBe("ready");
    if (plan.kind === "ready") expect(Object.isFrozen(plan.selectedSpan)).toBe(true);
  });

  it("marks unavailable, unreadable, escaping, and capped repositories incomplete", async () => {
    const unavailable = await snapshotNeonCrossFileRepository({
      ...repository({}, "/ws/config.neon"),
      listNeonFiles: async () => null,
      readFile: async () => null,
    });
    expect(unavailable.status).toBe("incomplete");
    expect(unavailable.incompleteReasons).toEqual(["repositoryUnavailable", "unreadableFile"]);

    const escaping = await snapshotNeonCrossFileRepository(
      repository({ "/ws/config.neon": "includes:\n  - ../outside.neon\n" }, "/ws/config.neon"),
    );
    expect(escaping.incompleteReasons).toContain("includeOutsideRoot");
    expect(planNeonCrossFileSymbolRename(escaping, 0, "x")).toEqual({
      kind: "rejected",
      reason: "incompleteRepository",
    });

    const many = Object.fromEntries(
      Array.from({ length: NEON_CROSS_FILE_MAX_FILES + 1 }, (_, index) => [
        `/ws/config/${String(index).padStart(3, "0")}.neon`,
        "services:\n",
      ]),
    );
    const capped = await snapshotNeonCrossFileRepository(repository(many, "/ws/config/000.neon"));
    expect(capped.status).toBe("incomplete");
    expect(capped.incompleteReasons).toContain("fileLimit");
    expect(capped.documents).toHaveLength(NEON_CROSS_FILE_MAX_FILES);
  });

  it("drops a repository that becomes stale after asynchronous reads", async () => {
    let current = true;
    const readFile = vi.fn(async () => {
      current = false;
      return "services:\n  mailer: App\\Mailer\n";
    });
    const snapshot = await snapshotNeonCrossFileRepository({
      activePath: "/ws/services.neon",
      rootPath: ROOT,
      isCurrent: () => current,
      listNeonFiles: async () => ["/ws/services.neon"],
      readFile,
    });
    expect(snapshot.status).toBe("incomplete");
    expect(snapshot.incompleteReasons).toContain("staleRepository");
  });
});

function repository(
  files: Readonly<Record<string, string>>,
  activePath: string,
): NeonCrossFileRepository {
  return {
    activePath,
    rootPath: ROOT,
    listNeonFiles: async () => Object.keys(files),
    readFile: async (path) => files[path] ?? null,
  };
}
