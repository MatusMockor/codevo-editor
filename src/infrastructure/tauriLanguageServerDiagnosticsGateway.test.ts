import { describe, expect, it, vi } from "vitest";
import { TauriLanguageServerDiagnosticsGateway } from "./tauriLanguageServerDiagnosticsGateway";
import type { LanguageServerDiagnosticEvent } from "../domain/languageServerDiagnostics";

type DiagnosticsGatewayConstructor = ConstructorParameters<
  typeof TauriLanguageServerDiagnosticsGateway
>;
type ListenToEvent = NonNullable<DiagnosticsGatewayConstructor[0]>;

describe("TauriLanguageServerDiagnosticsGateway", () => {
  it("does not listen outside Tauri", async () => {
    const listenToEvent = vi.fn<ListenToEvent>();
    const gateway = new TauriLanguageServerDiagnosticsGateway(
      listenToEvent,
      () => false,
    );

    const unsubscribe = await gateway.subscribeDiagnostics(vi.fn());
    unsubscribe();

    expect(listenToEvent).not.toHaveBeenCalled();
  });

  it("delegates diagnostics events inside Tauri", async () => {
    const event = diagnosticsEvent();
    const listenToEvent = vi.fn<ListenToEvent>(async (_event, handler) => {
      handler({ payload: event });
      return () => undefined;
    });
    const listener = vi.fn();
    const gateway = new TauriLanguageServerDiagnosticsGateway(
      listenToEvent,
      () => true,
    );

    await gateway.subscribeDiagnostics(listener);

    expect(listenToEvent).toHaveBeenCalledWith(
      "language-server://diagnostics",
      expect.any(Function),
    );
    expect(listener).toHaveBeenCalledWith(event);
  });
});

function diagnosticsEvent(): LanguageServerDiagnosticEvent {
  return {
    diagnostics: [
      {
        character: 2,
        line: 1,
        message: "Possible issue",
        severity: "warning",
        source: "phpactor",
      },
    ],
    sessionId: 1,
    uri: "file:///tmp/User.php",
    version: 3,
  };
}
