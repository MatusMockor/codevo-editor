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
    const gateway = new TauriLanguageServerDiagnosticsGateway(listenToEvent, () => false);

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
    const gateway = new TauriLanguageServerDiagnosticsGateway(listenToEvent, () => true);

    await gateway.subscribeDiagnostics(listener);

    expect(listenToEvent).toHaveBeenCalledWith(
      "language-server://diagnostics",
      expect.any(Function),
    );
    expect(listener).toHaveBeenCalledWith({
      ...event,
      projection: {
        ...event.projection,
        decodedUtf8Bytes: new TextEncoder().encode(JSON.stringify(event.diagnostics)).byteLength,
      },
    });
  });

  it("fails closed without clearing diagnostics for a malformed event", async () => {
    const listenToEvent = vi.fn<ListenToEvent>(async (_event, handler) => {
      handler({
        payload: {
          ...diagnosticsEvent(),
          diagnostics: [],
        },
      });
      handler({
        payload: {
          ...diagnosticsEvent(),
          projection: {
            ...diagnosticsEvent().projection,
            retainedUtf8Bytes: 0,
          },
        },
      });
      handler({
        payload: {
          rootPath: "/tmp",
          sessionId: 1,
          uri: "file:///tmp/User.php",
          version: 3,
          diagnostics: [],
          projection: {
            kind: "truncated",
            publishedCount: 0,
            retainedCount: 0,
            severityCounts: {
              error: 0,
              warning: 0,
              information: 0,
              hint: 0,
            },
            retainedUtf8Bytes: 2,
            omittedCount: 0,
            reasons: ["fieldLimit"],
            sanitizedFieldCount: 1,
          },
        },
      });
      return () => undefined;
    });
    const listener = vi.fn();
    const gateway = new TauriLanguageServerDiagnosticsGateway(listenToEvent, () => true);

    await gateway.subscribeDiagnostics(listener);

    expect(listener).not.toHaveBeenCalled();
  });
});

function diagnosticsEvent(): LanguageServerDiagnosticEvent {
  const diagnostics = [
    {
      code: null,
      codeDescriptionHref: null,
      character: 2,
      endCharacter: 3,
      endLine: 1,
      line: 1,
      message: "Possible issue",
      relatedInformation: [],
      severity: "warning" as const,
      source: "phpactor",
      tags: [],
    },
  ];
  return {
    diagnostics,
    rootPath: "/tmp",
    sessionId: 1,
    uri: "file:///tmp/User.php",
    version: 3,
    projection: {
      kind: "complete",
      publishedCount: 1,
      retainedCount: 1,
      severityCounts: {
        error: 0,
        warning: 1,
        information: 0,
        hint: 0,
      },
      retainedUtf8Bytes: new TextEncoder().encode(JSON.stringify(diagnostics)).byteLength,
    },
  };
}
