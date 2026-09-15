import { Channel } from "@tauri-apps/api/core";
import type { RemoteRunnerInventoryEvent, RemoteRunnerServerRequest } from "../domain/remoteRunner";
import { validateRemoteRunnerValue } from "../domain/remoteRunnerValidation";
import type { InvokeRemoteRunnerCommand } from "./tauriRemoteRunnerGateway";

/** The backend owns reconnect and credentials; only invalidation crosses IPC. */
export async function watchRemoteRunnerInventory(
  invoke: InvokeRemoteRunnerCommand,
  request: RemoteRunnerServerRequest,
  listener: (event: RemoteRunnerInventoryEvent) => void,
): Promise<() => void> {
  validateRemoteRunnerValue("getRunner", "request", request);
  const subscriptionId = crypto.randomUUID();
  const onEvent = new Channel<unknown>();
  let active = true;
  const dispose = () => {
    if (!active) return;
    active = false;
    onEvent.onmessage = () => {};
    void invoke("remote_runner_unsubscribe_changes", { request: { subscriptionId } }).catch(
      () => {},
    );
  };
  onEvent.onmessage = (value) => {
    if (!active) return;
    if (
      value === null ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).length !== 1 ||
      !("type" in value) ||
      typeof value.type !== "string" ||
      !["connected", "changed", "disconnected"].includes(value.type)
    ) {
      dispose();
      listener({ type: "disconnected" });
      return;
    }
    listener(value as RemoteRunnerInventoryEvent);
  };
  try {
    await invoke("remote_runner_subscribe_changes", {
      request: { serverId: request.serverId, subscriptionId },
      onEvent,
    });
  } catch (error) {
    dispose();
    throw error;
  }
  return dispose;
}
