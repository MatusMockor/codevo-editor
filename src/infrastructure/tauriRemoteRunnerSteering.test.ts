import { describe, expect, it, vi } from "vitest";
import { validateRemoteRunnerValue } from "../domain/remoteRunnerValidation";
import { TauriRemoteRunnerGateway } from "./tauriRemoteRunnerGateway";

const taskId = "12345678-1234-4234-8234-123456789abc";
const messageId = "12345678-1234-4234-8234-123456789abd";
const request = {
  serverId: "linux",
  taskId,
  idempotencyKey: messageId,
  parts: [{ type: "text" as const, text: "Please focus on the bug" }],
};
const accepted = { taskId, messageId, status: "accepted" };

describe("remote runner steering wire", () => {
  it("preserves exact ordered attachment references and idempotency", async () => {
    const invoke = vi.fn().mockResolvedValue(accepted);
    const withImage = {
      ...request,
      parts: [...request.parts, { type: "attachment" as const, attachmentId: messageId }],
    };
    expect(await new TauriRemoteRunnerGateway(invoke).steerTask(withImage)).toEqual(accepted);
    expect(invoke).toHaveBeenCalledExactlyOnceWith("remote_runner_steer_task", {
      request: withImage,
    });
  });
  it("sends pending identity atomically without copying its parts", async () => {
    const invoke = vi.fn().mockResolvedValue(accepted);
    const pending = { serverId: "linux", taskId, pendingId: messageId };
    expect(await new TauriRemoteRunnerGateway(invoke).steerPendingMessage(pending)).toEqual(
      accepted,
    );
    expect(invoke).toHaveBeenCalledExactlyOnceWith("remote_runner_steer_pending_message", {
      request: pending,
    });
  });
  it.each(["launch", "instructions", "provider", "sessionId", "cwd", "command"])(
    "rejects %s before IPC",
    async (field) => {
      const invoke = vi.fn();
      await expect(
        new TauriRemoteRunnerGateway(invoke).steerTask({ ...request, [field]: "foreign" }),
      ).rejects.toThrow();
      expect(invoke).not.toHaveBeenCalled();
    },
  );
  it.each(
    [
      [],
      [{ type: "text", text: "é".repeat(24_001) }],
      [{ type: "attachment", attachmentId: "/tmp/local.png" }],
      [
        { type: "attachment", attachmentId: messageId },
        { type: "attachment", attachmentId: messageId },
      ],
      [{ type: "text", text: "\0" }],
    ].map((parts) => ({ parts })),
  )("rejects malformed/unbounded parts $parts", ({ parts }) => {
    expect(() =>
      validateRemoteRunnerValue("steerTask", "request", { ...request, parts }),
    ).toThrow();
  });
  it.each(["steerTask", "steerPendingMessage"] as const)(
    "rejects foreign response identity for %s",
    async (operation) => {
      const argument =
        operation === "steerTask" ? request : { serverId: "linux", taskId, pendingId: messageId };
      for (const response of [
        { ...accepted, taskId: messageId },
        { ...accepted, messageId: taskId },
        { ...accepted, status: "queued" },
        { ...accepted, unknown: true },
      ]) {
        const gateway = new TauriRemoteRunnerGateway(vi.fn().mockResolvedValue(response));
        await expect(
          operation === "steerTask"
            ? gateway.steerTask(request)
            : gateway.steerPendingMessage({ serverId: "linux", taskId, pendingId: messageId }),
        ).rejects.toThrow();
      }
      expect(() =>
        validateRemoteRunnerValue(operation, "request", { ...argument, parts: [] }),
      ).toThrow();
    },
  );
  it.each([undefined, false, true, null, 1, "true"])(
    "validates optional taskSteering capability %j",
    (taskSteering) => {
      const check = () =>
        validateRemoteRunnerValue("getRunner", "response", {
          protocolVersion: 1,
          runnerId: "runner",
          name: "Runner",
          capabilities: { taskExecution: true, eventReplay: true, taskSteering },
        });
      if (taskSteering === undefined || typeof taskSteering === "boolean")
        expect(check).not.toThrow();
      else expect(check).toThrow();
    },
  );
});

it("preserves uncertain pending delivery without claiming dispatched task identity", () => {
  const pending = {
    id: messageId,
    conversationId: taskId,
    status: "uncertain",
    parts: request.parts,
    createdAt: "2026-09-18T00:00:00.000Z",
    taskId: null,
  };
  expect(() =>
    validateRemoteRunnerValue("listPendingMessages", "response", { items: [pending] }),
  ).not.toThrow();
  expect(() =>
    validateRemoteRunnerValue("listPendingMessages", "response", {
      items: [{ ...pending, taskId }],
    }),
  ).toThrow();
});
