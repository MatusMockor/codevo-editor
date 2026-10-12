import { describe, expect, it } from "vitest";
import type {
  RemoteRunnerEventPage,
  RemoteRunnerEventsBeforeRequest,
  RemoteRunnerTaskRequest,
} from "../domain/remoteRunner";
import {
  RemoteInventoryRevoked,
  type RemoteAgentInventorySnapshot,
} from "./remoteAgentInventoryLoad";
import {
  deferred,
  fakeRunnerGateway,
  loadTailFirst,
  projectedTurn,
  remoteTurn,
} from "./remoteAgentTailFirstTestSupport";
import { claudeTextLine, FakeRunnerEvents } from "./remoteAgentTurnActivityTestSupport";

type RevocationPoint = "publication" | "settlement";
const REVOCATION_POINTS: readonly RevocationPoint[] = ["publication", "settlement"];

function authority() {
  let valid = true;
  const revoke = () => {
    valid = false;
  };
  return {
    valid: () => valid,
    revoke,
    revokeAt: (point: RevocationPoint) => {
      switch (point) {
        case "publication":
          revoke();
          return;
        case "settlement":
          queueMicrotask(revoke);
          return;
        default:
          expect(point satisfies never).toBeUndefined();
      }
    },
  };
}

function output(runner: FakeRunnerEvents, taskId: string, count: number): void {
  for (let index = 0; index < count; index += 1)
    runner.output(taskId, claudeTextLine(`line ${index} `));
}

describe("remote inventory publication authority", () => {
  it("does not expose a partially read legacy terminal replay while its next page is pending or fails", async () => {
    const runner = new FakeRunnerEvents();
    output(runner, "turn-1", 100);
    const h = fakeRunnerGateway(runner, [remoteTurn(1)], {});
    const second = deferred<RemoteRunnerEventPage>();
    const requested = deferred<void>();
    const published: RemoteAgentInventorySnapshot[] = [];
    h.calls.listEvents.mockImplementation(
      (request: RemoteRunnerTaskRequest & Readonly<{ after: number }>) => {
        if (request.after === 0) return runner.listEvents(request);
        requested.resolve();
        return second.promise;
      },
    );
    const loading = loadTailFirst(h.gateway, undefined, (snapshot) => published.push(snapshot));
    const rejected = expect(loading).rejects.toThrow("Second page failed.");

    await requested.promise;

    expect(h.forward()).toHaveLength(2);
    expect(published).toHaveLength(1);
    expect(published.every((snapshot) => !snapshot.replays.has("turn-1"))).toBe(true);
    expect(published.every((snapshot) => !snapshot.replayComplete.has("turn-1"))).toBe(true);
    expect(projectedTurn(published[0]!, "turn-1")?.eventsTruncated).toBe(true);

    second.reject(new Error("Second page failed."));
    await rejected;

    expect(published.every((snapshot) => !snapshot.replays.has("turn-1"))).toBe(true);
    expect(published.every((snapshot) => !snapshot.replayComplete.has("turn-1"))).toBe(true);
    expect(projectedTurn(published[0]!, "turn-1")?.eventsTruncated).toBe(true);
    expect(h.calls.getTaskResume).not.toHaveBeenCalled();
  });

  it.each(REVOCATION_POINTS)(
    "does not request resume or an older task after legacy settlement revokes authority at %s",
    async (point) => {
      const runner = new FakeRunnerEvents();
      output(runner, "turn-1", 10);
      output(runner, "turn-2", 10);
      const h = fakeRunnerGateway(runner, [remoteTurn(1), remoteTurn(2)], {});
      const owner = authority();

      await expect(
        loadTailFirst(
          h.gateway,
          undefined,
          (snapshot) => {
            if (!snapshot.replays.has("turn-2")) return;
            owner.revokeAt(point);
          },
          owner.valid,
        ),
      ).rejects.toBeInstanceOf(RemoteInventoryRevoked);

      expect(h.backward()).toEqual([]);
      expect(h.forward().every((request) => request.taskId === "turn-2")).toBe(true);
      expect(h.forward()).toHaveLength(1);
      expect(h.calls.getTaskResume).not.toHaveBeenCalled();
    },
  );

  it("does not read the next legacy page after its gateway await loses authority", async () => {
    const runner = new FakeRunnerEvents();
    output(runner, "turn-1", 100);
    const h = fakeRunnerGateway(runner, [remoteTurn(1)], {});
    const owner = authority();
    h.calls.listEvents.mockImplementationOnce(
      async (request: RemoteRunnerTaskRequest & Readonly<{ after: number }>) => {
        const page = await runner.listEvents(request);
        owner.revoke();
        return page;
      },
    );

    await expect(
      loadTailFirst(h.gateway, undefined, undefined, owner.valid),
    ).rejects.toBeInstanceOf(RemoteInventoryRevoked);

    expect(h.forward()).toHaveLength(1);
    expect(h.calls.getTaskResume).not.toHaveBeenCalled();
  });

  it("does not request a tail after metadata publication revokes authority", async () => {
    const runner = new FakeRunnerEvents();
    output(runner, "turn-1", 100);
    const h = fakeRunnerGateway(runner, [remoteTurn(1)]);
    const owner = authority();

    await expect(
      loadTailFirst(h.gateway, undefined, owner.revoke, owner.valid),
    ).rejects.toBeInstanceOf(RemoteInventoryRevoked);

    expect(h.backward()).toEqual([]);
    expect(h.forward()).toEqual([]);
    expect(h.calls.getTaskResume).not.toHaveBeenCalled();
  });

  it.each(REVOCATION_POINTS)(
    "does not request resume or another tail after a tail revokes authority at %s",
    async (point) => {
      const runner = new FakeRunnerEvents();
      output(runner, "turn-1", 100);
      output(runner, "turn-2", 100);
      const h = fakeRunnerGateway(runner, [remoteTurn(1), remoteTurn(2)]);
      const owner = authority();

      await expect(
        loadTailFirst(
          h.gateway,
          undefined,
          (snapshot) => {
            if (!snapshot.replays.has("turn-2")) return;
            owner.revokeAt(point);
          },
          owner.valid,
        ),
      ).rejects.toBeInstanceOf(RemoteInventoryRevoked);

      expect(h.backward()).toHaveLength(1);
      expect(h.backward()[0]?.taskId).toBe("turn-2");
      expect(h.forward()).toEqual([]);
      expect(h.calls.getTaskResume).not.toHaveBeenCalled();
    },
  );

  it.each(REVOCATION_POINTS)(
    "does not poll live or read another page after backfill revokes authority at %s",
    async (point) => {
      const runner = new FakeRunnerEvents();
      output(runner, "turn-1", 600);
      const h = fakeRunnerGateway(runner, [remoteTurn(1, { status: "running" })]);
      const owner = authority();
      const stopAfter = point === "publication" ? 5 : 2;

      await expect(
        loadTailFirst(
          h.gateway,
          undefined,
          () => {
            if (h.backward().length !== stopAfter) return;
            owner.revokeAt(point);
          },
          owner.valid,
        ),
      ).rejects.toBeInstanceOf(RemoteInventoryRevoked);

      expect(h.backward()).toHaveLength(stopAfter);
      expect(h.forward()).toEqual([]);
      expect(h.calls.getTaskResume).toHaveBeenCalledTimes(1);
    },
  );

  it.each(REVOCATION_POINTS)(
    "does not read another backfill page after a live poll revokes authority at %s",
    async (point) => {
      const runner = new FakeRunnerEvents();
      output(runner, "turn-1", 600);
      const h = fakeRunnerGateway(runner, [remoteTurn(1, { status: "running" })]);
      const owner = authority();
      h.calls.listEventsBefore.mockImplementation(
        async (request: RemoteRunnerEventsBeforeRequest) => {
          const page = await runner.listEventsBefore(request);
          if (h.backward().length === 5) runner.output("turn-1", claudeTextLine("arrived "));
          return page;
        },
      );

      await expect(
        loadTailFirst(
          h.gateway,
          undefined,
          () => {
            if (h.forward().length === 0) return;
            owner.revokeAt(point);
          },
          owner.valid,
        ),
      ).rejects.toBeInstanceOf(RemoteInventoryRevoked);

      expect(h.backward()).toHaveLength(5);
      expect(h.forward()).toHaveLength(1);
      expect(h.calls.getTaskResume).toHaveBeenCalledTimes(1);
    },
  );

  it.each(REVOCATION_POINTS)(
    "does not read another input-scan page after scanning revokes authority at %s",
    async (point) => {
      const runner = new FakeRunnerEvents();
      runner.input("turn-1", "early", "earlier steering");
      output(runner, "turn-1", 2_400);
      const h = fakeRunnerGateway(runner, [remoteTurn(1)]);
      const previous = await loadTailFirst(h.gateway);
      const scan = previous.replayBackfill?.get("turn-1");
      expect(scan?.kind).toBe("scanningInputs");
      h.calls.listEventsBefore.mockClear();
      h.calls.getTaskResume.mockClear();
      const owner = authority();

      await expect(
        loadTailFirst(h.gateway, previous, () => owner.revokeAt(point), owner.valid),
      ).rejects.toBeInstanceOf(RemoteInventoryRevoked);

      expect(h.backward()).toHaveLength(1);
      expect(h.backward()[0]?.before).toBe(
        scan?.kind === "scanningInputs" ? scan.before : undefined,
      );
      expect(h.forward()).toEqual([]);
      expect(h.calls.getTaskResume).toHaveBeenCalledTimes(1);
    },
  );

  it("does not request another task's tail after resume settles with revoked authority", async () => {
    const runner = new FakeRunnerEvents();
    output(runner, "turn-1", 100);
    output(runner, "turn-2", 100);
    const h = fakeRunnerGateway(runner, [remoteTurn(1), remoteTurn(2)]);
    const resume = deferred<{ available: boolean; reason: null }>();
    const requested = deferred<void>();
    const owner = authority();
    h.calls.getTaskResume.mockImplementation(() => {
      requested.resolve();
      return resume.promise;
    });
    const loading = loadTailFirst(h.gateway, undefined, undefined, owner.valid);
    const revoked = expect(loading).rejects.toBeInstanceOf(RemoteInventoryRevoked);

    await requested.promise;
    owner.revoke();
    resume.resolve({ available: true, reason: null });
    await revoked;

    expect(h.backward()).toHaveLength(1);
    expect(h.backward()[0]?.taskId).toBe("turn-2");
    expect(h.forward()).toEqual([]);
    expect(h.calls.getTaskResume).toHaveBeenCalledTimes(1);
  });
});
