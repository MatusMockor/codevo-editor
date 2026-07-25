import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  JsTestWatchGateway,
  JsTestWatchOutputEvent,
  JsTestWatchOwner,
  JsTestWatchStatusEvent,
  StartJsTestWatchRequest,
  StartJsTestWatchResult,
} from "../domain/jsTestCommand";
import {
  decodeJsTestWatchOutputEvent,
  decodeJsTestWatchStatusEvent,
  invokeAcknowledgeJsTestWatchStartIpc,
  invokeStartJsTestWatchIpc,
  invokeStopJsTestWatchIpc,
  JS_TEST_WATCH_OUTPUT_EVENT,
  JS_TEST_WATCH_STATUS_EVENT,
  type InvokeJsTestWatchCommand,
} from "./tauriJsTestWatchIpcContract";

const invokeJsTestWatchCommand: InvokeJsTestWatchCommand = (command, args) => invoke(command, args);

export type ListenToJsTestWatchEvents = (
  event: string,
  handler: (event: { payload: unknown }) => void,
) => Promise<() => void>;

const listenToJsTestWatchEvents: ListenToJsTestWatchEvents = (event, handler) =>
  listen<unknown>(event, handler);

export class TauriJsTestWatchGateway implements JsTestWatchGateway {
  constructor(
    private readonly invokeCommand: InvokeJsTestWatchCommand = invokeJsTestWatchCommand,
    private readonly listenToEvent: ListenToJsTestWatchEvents = listenToJsTestWatchEvents,
  ) {}

  startWatch(request: StartJsTestWatchRequest): Promise<StartJsTestWatchResult> {
    return invokeStartJsTestWatchIpc(this.invokeCommand, request);
  }

  acknowledgeWatchStart(owner: JsTestWatchOwner): Promise<void> {
    return invokeAcknowledgeJsTestWatchStartIpc(this.invokeCommand, owner);
  }

  stopWatch(owner: JsTestWatchOwner): Promise<void> {
    return invokeStopJsTestWatchIpc(this.invokeCommand, owner);
  }

  subscribeWatchStatus(handler: (event: JsTestWatchStatusEvent) => void): Promise<() => void> {
    return this.subscribeDecoded(JS_TEST_WATCH_STATUS_EVENT, decodeJsTestWatchStatusEvent, handler);
  }

  subscribeWatchOutput(handler: (event: JsTestWatchOutputEvent) => void): Promise<() => void> {
    return this.subscribeDecoded(JS_TEST_WATCH_OUTPUT_EVENT, decodeJsTestWatchOutputEvent, handler);
  }

  private subscribeDecoded<T>(
    eventName: string,
    decode: (payload: unknown) => T,
    handler: (event: T) => void,
  ): Promise<() => void> {
    return this.listenToEvent(eventName, (event) => {
      try {
        handler(decode(event.payload));
      } catch {
        return;
      }
    });
  }
}
