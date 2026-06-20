import { describe, expect, it, vi } from "vitest";
import type { LanguageServerRefreshEvent } from "../domain/languageServerFeatures";
import {
  JAVASCRIPT_TYPESCRIPT_REFRESH_EVENT,
  TauriLanguageServerRefreshGateway,
} from "./tauriLanguageServerRefreshGateway";

type GatewayConstructor = ConstructorParameters<
  typeof TauriLanguageServerRefreshGateway
>;
type ListenToRefreshEvent = NonNullable<GatewayConstructor[0]>;

describe("TauriLanguageServerRefreshGateway", () => {
  it("returns a noop unsubscribe outside Tauri", async () => {
    const listen = vi.fn<ListenToRefreshEvent>();
    const gateway = new TauriLanguageServerRefreshGateway(listen, () => false);
    const unsubscribe = await gateway.subscribeRefreshEvents(vi.fn());

    unsubscribe();

    expect(listen).not.toHaveBeenCalled();
  });

  it("subscribes to refresh events inside Tauri", async () => {
    const listener = vi.fn();
    const unsubscribe = vi.fn();
    const eventPayload = refreshEvent();
    const listen = vi.fn<ListenToRefreshEvent>(async (_event, handler) => {
      handler({ payload: eventPayload });
      return unsubscribe;
    });
    const gateway = new TauriLanguageServerRefreshGateway(
      listen,
      () => true,
      JAVASCRIPT_TYPESCRIPT_REFRESH_EVENT,
    );

    await expect(gateway.subscribeRefreshEvents(listener)).resolves.toBe(
      unsubscribe,
    );

    expect(listen).toHaveBeenCalledWith(
      JAVASCRIPT_TYPESCRIPT_REFRESH_EVENT,
      expect.any(Function),
    );
    expect(listener).toHaveBeenCalledWith(eventPayload);
  });
});

function refreshEvent(): LanguageServerRefreshEvent {
  return {
    feature: "inlayHint",
    rootPath: "/project",
    sessionId: 1,
  };
}
