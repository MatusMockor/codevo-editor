import { describe, expect, it, vi } from "vitest";
import type { DebugEvent } from "../domain/debug";
import type { VscodeNodeServerReadyActionRecipe } from "../domain/vscodeNodeLaunchConfiguration";
import {
  MAX_SERVER_READY_EARLY_SESSIONS,
  MAX_SERVER_READY_SCAN_CHUNK_CHARACTERS,
  ServerReadyActionCoordinator,
  type ServerReadyActionOwner,
} from "./serverReadyActionCoordinator";

const OWNER: ServerReadyActionOwner = {
  configurationVersion: 7,
  rootPath: "/workspace",
  workspaceEpoch: 3,
  workspaceId: "owner-a",
};
const RECIPE: VscodeNodeServerReadyActionRecipe = {
  action: "openExternally",
  match: { kind: "port", prefix: "Listening on port ", suffix: "!" },
  uri: { scheme: "http", host: "localhost", path: "/health" },
};

describe("ServerReadyActionCoordinator", () => {
  it("buffers early output and opens only after the exact accepted session is adopted", () => {
    const coordinator = new ServerReadyActionCoordinator();
    const lease = coordinator.begin({ isOwnerCurrent: () => true, owner: OWNER, recipe: RECIPE })!;

    expect(coordinator.observe(output(11, 1, "Listening on port 41"))).toBeNull();
    expect(coordinator.observe(output(12, 1, "Listening on port 3000!"))).toBeNull();
    expect(coordinator.observe(output(11, 2, "73!"))).toBeNull();
    expectAuthorized(coordinator, coordinator.adopt(lease, 11), "http://localhost:4173/health");
    expect(coordinator.observe(output(11, 3, "Listening on port 5000!"))).toBeNull();
  });

  it("matches across chunks after adoption and consumes before a caller opens", () => {
    const coordinator = new ServerReadyActionCoordinator();
    const lease = coordinator.begin({ isOwnerCurrent: () => true, owner: OWNER, recipe: RECIPE })!;
    expect(coordinator.adopt(lease, 5)).toBeNull();
    expect(coordinator.observe(output(5, 1, "noise Listening on "))).toBeNull();
    expectAuthorized(
      coordinator,
      coordinator.observe(output(5, 2, "port 8080!")),
      "http://localhost:8080/health",
    );
    expect(coordinator.observe(output(5, 3, "Listening on port 8081!"))).toBeNull();
  });

  it("never synthesizes a match across stdout and stderr", () => {
    const coordinator = new ServerReadyActionCoordinator();
    const lease = coordinator.begin({ isOwnerCurrent: () => true, owner: OWNER, recipe: RECIPE })!;
    coordinator.adopt(lease, 6);
    expect(
      coordinator.observe(output(6, 1, "Listening on port ", "/workspace", "stdout")),
    ).toBeNull();
    expect(coordinator.observe(output(6, 2, "3000!", "/workspace", "stderr"))).toBeNull();
    expectAuthorized(
      coordinator,
      coordinator.observe(output(6, 3, "3000!", "/workspace", "stdout")),
      "http://localhost:3000/health",
    );
  });

  it("scans a large event in bounded chunks and preserves a boundary-spanning match", () => {
    const coordinator = new ServerReadyActionCoordinator();
    const lease = coordinator.begin({ isOwnerCurrent: () => true, owner: OWNER, recipe: RECIPE })!;
    coordinator.adopt(lease, 7);
    const padding = "x".repeat(MAX_SERVER_READY_SCAN_CHUNK_CHARACTERS - "Listening on ".length);
    expectAuthorized(
      coordinator,
      coordinator.observe(output(7, 1, `${padding}Listening on port 9229!`)),
      "http://localhost:9229/health",
    );
  });

  it("fails closed on same-root early-session overflow instead of reviving an evicted match", () => {
    const coordinator = new ServerReadyActionCoordinator();
    const lease = coordinator.begin({ isOwnerCurrent: () => true, owner: OWNER, recipe: RECIPE })!;
    coordinator.observe(output(1, 1, "Listening on port 3000!"));
    for (let id = 2; id <= MAX_SERVER_READY_EARLY_SESSIONS + 1; id += 1) {
      coordinator.observe(output(id, 1, "noise"));
    }
    expect(coordinator.adopt(lease, 1)).toBeNull();
  });

  it("ignores foreign roots and stale or duplicate sequence numbers", () => {
    const coordinator = new ServerReadyActionCoordinator();
    const lease = coordinator.begin({ isOwnerCurrent: () => true, owner: OWNER, recipe: RECIPE })!;
    expect(coordinator.adopt(lease, 9)).toBeNull();
    expect(coordinator.observe(output(9, 2, "Listening on port 30", "/other"))).toBeNull();
    expect(coordinator.observe(output(9, 2, "Listening on port 30"))).toBeNull();
    expect(coordinator.observe(output(9, 2, "00!"))).toBeNull();
    expectAuthorized(
      coordinator,
      coordinator.observe(output(9, 3, "00!")),
      "http://localhost:3000/health",
    );
  });

  it("cancels exact stop, terminate, replacement, and unmount leases", () => {
    const coordinator = new ServerReadyActionCoordinator();
    const first = coordinator.begin({ isOwnerCurrent: () => true, owner: OWNER, recipe: RECIPE })!;
    coordinator.adopt(first, 4);
    expect(coordinator.cancelSession("/workspace", 4)).toBe(true);
    expect(coordinator.observe(output(4, 1, "Listening on port 3000!"))).toBeNull();

    const second = coordinator.begin({ isOwnerCurrent: () => true, owner: OWNER, recipe: RECIPE })!;
    coordinator.adopt(second, 5);
    coordinator.observe(terminated(5, 1));
    expect(coordinator.observe(output(5, 2, "Listening on port 3000!"))).toBeNull();

    const third = coordinator.begin({ isOwnerCurrent: () => true, owner: OWNER, recipe: RECIPE })!;
    const fourth = coordinator.begin({ isOwnerCurrent: () => true, owner: OWNER, recipe: RECIPE })!;
    expect(coordinator.adopt(third, 6)).toBeNull();
    coordinator.clear();
    expect(coordinator.adopt(fourth, 7)).toBeNull();
  });

  it("invalidates A-B-A configuration/trust ownership before opening", () => {
    const coordinator = new ServerReadyActionCoordinator();
    let currentEpoch = OWNER.workspaceEpoch;
    const predicate = vi.fn(
      (owner: ServerReadyActionOwner) => owner.workspaceEpoch === currentEpoch,
    );
    const lease = coordinator.begin({ isOwnerCurrent: predicate, owner: OWNER, recipe: RECIPE })!;
    coordinator.adopt(lease, 8);
    currentEpoch += 2;
    expect(coordinator.observe(output(8, 1, "Listening on port 3000!"))).toBeNull();
    currentEpoch = OWNER.workspaceEpoch;
    expect(coordinator.observe(output(8, 2, "Listening on port 3001!"))).toBeNull();
  });

  it("waits for a delimiter for an empty suffix and rejects invalid ports", () => {
    const coordinator = new ServerReadyActionCoordinator();
    const lease = coordinator.begin({
      isOwnerCurrent: () => true,
      owner: OWNER,
      recipe: { ...RECIPE, match: { ...RECIPE.match, suffix: "" } },
    })!;
    coordinator.adopt(lease, 10);
    expect(coordinator.observe(output(10, 1, "Listening on port 6553"))).toBeNull();
    expectAuthorized(
      coordinator,
      coordinator.observe(output(10, 2, "6\nListening on port 65535\n")),
      "http://localhost:65535/health",
    );
  });

  it("rejects fabricated semantic recipes that bypass parser grammar", () => {
    const coordinator = new ServerReadyActionCoordinator();

    expect(
      coordinator.begin({
        isOwnerCurrent: () => true,
        owner: OWNER,
        recipe: {
          action: "openExternally",
          match: { kind: "port", prefix: "Listening on port ", suffix: "0" },
          uri: { scheme: "http", host: "localhost", path: "/%2e%2e/private" },
        },
      }),
    ).toBeNull();
  });
});

function output(
  sessionId: number,
  seq: number,
  text: string,
  rootPath = "/workspace",
  stream: "stdout" | "stderr" = "stdout",
): DebugEvent {
  return {
    payload: { kind: "output", stream, text },
    rootPath,
    seq,
    sessionId,
  };
}

function terminated(sessionId: number, seq: number): DebugEvent {
  return {
    payload: { exitCode: 0, kind: "terminated" },
    rootPath: "/workspace",
    seq,
    sessionId,
  };
}

function expectAuthorized(
  coordinator: ServerReadyActionCoordinator,
  request: ReturnType<ServerReadyActionCoordinator["observe"]>,
  expected: string,
): void {
  expect(request).not.toBeNull();
  expect(coordinator.authorize(request!)).toBe(expected);
}
