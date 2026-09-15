import { describe, expect, it, vi } from "vitest";
import { TauriRemoteRunnerGateway } from "./tauriRemoteRunnerGateway";
import { validateRemoteRunnerValue } from "../domain/remoteRunnerValidation";
const id = "12345678-1234-4234-8234-123456789abc";
const other = "12345678-1234-4234-8234-123456789abd";
const request = { serverId: "linux", taskId: id };
const pending = {
  id,
  conversationId: id,
  status: "queued",
  parts: [{ type: "text", text: "Next task" }],
  createdAt: "2026-09-15T12:00:00.000Z",
  taskId: null,
};
describe("remote pending message boundary", () => {
  it("preserves queue request identity, parts and launch without transport credentials", async () => {
    const invoke = vi.fn().mockResolvedValue({ pending, created: true });
    const enqueue = {
      ...request,
      idempotencyKey: id,
      parts: pending.parts as readonly { type: "text"; text: string }[],
      launch: {
        provider: "codex" as const,
        model: "gpt-6-astra" as const,
        mode: "readOnly" as const,
      },
    };
    expect(await new TauriRemoteRunnerGateway(invoke).enqueueMessage(enqueue)).toEqual({
      pending,
      created: true,
    });
    expect(invoke).toHaveBeenCalledWith("remote_runner_enqueue_message", { request: enqueue });
  });
  it("lists and explicitly resumes the persisted queue", async () => {
    const invoke = vi.fn().mockResolvedValue({ items: [pending] });
    const gateway = new TauriRemoteRunnerGateway(invoke);
    expect(await gateway.listPendingMessages(request)).toEqual({ items: [pending] });
    expect(await gateway.resumePendingMessages(request)).toEqual({ items: [pending] });
    expect(invoke.mock.calls).toEqual([
      ["remote_runner_list_pending_messages", { request }],
      ["remote_runner_resume_pending_messages", { request }],
    ]);
  });
  it("cancels only the exact requested pending item", async () => {
    const invoke = vi.fn().mockResolvedValue({ ...pending, status: "cancelled" });
    const gateway = new TauriRemoteRunnerGateway(invoke);
    await expect(
      gateway.cancelPendingMessage({ ...request, pendingId: id }),
    ).resolves.toMatchObject({ status: "cancelled" });
    await expect(gateway.cancelPendingMessage({ ...request, pendingId: other })).rejects.toThrow(
      "different pending",
    );
  });
  it.each([
    { items: [pending, pending] },
    { items: [pending, { ...pending, id: other, conversationId: other }] },
    { items: [{ ...pending, status: "dispatched", taskId: other }] },
    { items: [{ ...pending, status: "queued", taskId: other }] },
    { items: [{ ...pending, command: "secret" }] },
    {
      items: Array.from({ length: 17 }, (_, i) => ({
        ...pending,
        id: `12345678-1234-4234-8234-${i.toString().padStart(12, "0")}`,
      })),
    },
  ])("rejects malformed or non-active queue snapshots", async (response) => {
    const gateway = new TauriRemoteRunnerGateway(vi.fn().mockResolvedValue(response));
    await expect(gateway.listPendingMessages(request)).rejects.toThrow("response");
  });
  it("rejects endpoint injection before invoking native transport", async () => {
    const invoke = vi.fn();
    const gateway = new TauriRemoteRunnerGateway(invoke);
    await expect(
      gateway.cancelPendingMessage({ ...request, pendingId: "../other" }),
    ).rejects.toThrow("request");
    expect(invoke).not.toHaveBeenCalled();
  });
  it("accepts an idempotent dispatched response while rejecting invalid task linkage", () => {
    expect(() =>
      validateRemoteRunnerValue("enqueueMessage", "response", {
        pending: { ...pending, status: "dispatched", taskId: other },
        created: false,
      }),
    ).not.toThrow();
    expect(() =>
      validateRemoteRunnerValue("enqueueMessage", "response", {
        pending: { ...pending, status: "dispatched" },
        created: false,
      }),
    ).toThrow();
  });
});
