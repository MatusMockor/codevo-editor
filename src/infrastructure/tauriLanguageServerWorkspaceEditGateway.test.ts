import { describe, expect, it, vi } from "vitest";
import {
  JAVASCRIPT_TYPESCRIPT_WORKSPACE_EDIT_EVENT,
  TauriLanguageServerWorkspaceEditGateway,
} from "./tauriLanguageServerWorkspaceEditGateway";
import type { LanguageServerWorkspaceEditEvent } from "../domain/languageServerFeatures";

type GatewayConstructor = ConstructorParameters<
  typeof TauriLanguageServerWorkspaceEditGateway
>;
type ListenToWorkspaceEdit = NonNullable<GatewayConstructor[0]>;

describe("TauriLanguageServerWorkspaceEditGateway", () => {
  it("returns a noop unsubscribe outside Tauri", async () => {
    const listen = vi.fn<ListenToWorkspaceEdit>();
    const gateway = new TauriLanguageServerWorkspaceEditGateway(
      listen,
      () => false,
    );
    const unsubscribe = await gateway.subscribeWorkspaceEdits(vi.fn());

    unsubscribe();

    expect(listen).not.toHaveBeenCalled();
  });

  it("subscribes to workspace edit events inside Tauri", async () => {
    const listener = vi.fn();
    const unsubscribe = vi.fn();
    const eventPayload = workspaceEditEvent();
    const listen = vi.fn<ListenToWorkspaceEdit>(async (_event, handler) => {
      handler({ payload: eventPayload });
      return unsubscribe;
    });
    const gateway = new TauriLanguageServerWorkspaceEditGateway(
      listen,
      () => true,
      JAVASCRIPT_TYPESCRIPT_WORKSPACE_EDIT_EVENT,
    );

    await expect(gateway.subscribeWorkspaceEdits(listener)).resolves.toBe(
      unsubscribe,
    );

    expect(listen).toHaveBeenCalledWith(
      JAVASCRIPT_TYPESCRIPT_WORKSPACE_EDIT_EVENT,
      expect.any(Function),
    );
    expect(listener).toHaveBeenCalledWith(eventPayload);
  });
});

function workspaceEditEvent(): LanguageServerWorkspaceEditEvent {
  return {
    edit: {
      changes: {
        "file:///project/src/user.ts": [
          {
            newText: "Account",
            range: {
              end: { character: 5, line: 0 },
              start: { character: 1, line: 0 },
            },
          },
        ],
      },
    },
    label: "Rename symbol",
    rootPath: "/project",
    sessionId: 1,
  };
}
