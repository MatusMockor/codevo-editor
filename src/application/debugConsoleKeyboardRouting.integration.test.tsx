// @vitest-environment jsdom

import { act, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { DebugConsolePanel } from "../components/DebugConsolePanel";
import { createDebugConsoleState } from "../domain/debugConsoleState";
import { defaultAppSettings } from "../domain/settings";
import { CommandRegistry, executeCommand } from "./commandRegistry";
import type { UseDebugConsoleResult } from "./useDebugConsole";
import {
  useDebugConsoleSurfaceCommands,
  type UseDebugConsoleSurfaceCommandsResult,
} from "./useDebugConsoleSurfaceCommands";
import { useWorkbenchKeyboardShortcuts } from "./useWorkbenchKeyboardShortcuts";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const OWNER = { pauseGeneration: 1, sessionId: 7 } as const;
const COMMAND_CONTEXT = {
  activeDocumentDirty: false,
  hasActiveDocument: true,
  hasWorkspace: true,
} as const;

describe("Debug Console keyboard routing integration", () => {
  it("opens a hidden panel and delivers the focus request through the real shortcut dispatcher", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const consoleResult: UseDebugConsoleResult = {
      clear: vi.fn(),
      state: createDebugConsoleState(OWNER),
      submit: vi.fn(),
};
const EDITOR_SURFACE_IDENTITY = {};
    const captured: { current: UseDebugConsoleSurfaceCommandsResult | null } = { current: null };
    let deliveredFocusRequest: UseDebugConsoleSurfaceCommandsResult["focusRequest"] = null;

    function Harness() {
      const [panelOpen, setPanelOpen] = useState(false);
      const consoleSurface = useDebugConsoleSurfaceCommands({
        console: consoleResult,
        openDebugPanel: () => setPanelOpen(true),
        workspaceOwnerKey: "workspace-a",
        isWorkspaceTrusted: () => true,
      });
      captured.current = consoleSurface;
      const commandRegistry = useMemo(() => {
        const registry = new CommandRegistry();
        registry.register({
          category: "Debug",
          id: "debug.focusConsole",
          isEnabled: (context) => context.hasWorkspace,
          run: consoleSurface.focus,
          title: "Debug: Focus Debug Console",
        });
        return registry;
      }, [consoleSurface.focus]);
      const appSettingsRef = useRef(defaultAppSettings());
      const bareKeyShortcutsRef = useRef({ keymap: null, keys: new Set<string>() });
      const doubleShiftDetectorRef = useRef({
        handleKeyDown: vi.fn(() => false),
        reset: vi.fn(),
      });

      useWorkbenchKeyboardShortcuts({
        actions: {
          closeFloatingSurface: () => false,
          openSearchEverywhere: vi.fn(),
        },
        appSettingsRef,
        bareKeyShortcutsRef,
        commandContext: COMMAND_CONTEXT,
        commandRegistry,
        doubleShiftDetectorRef,
        editorSurfaceIdentity: EDITOR_SURFACE_IDENTITY,
        keymap: appSettingsRef.current.keymap,
        runCommand: (id, context = COMMAND_CONTEXT) => executeCommand(commandRegistry, id, context),
      });

      return panelOpen ? (
        <DebugConsolePanel
          console={consoleResult}
          enabled
          focusRequest={consoleSurface.focusRequest}
          onFocusRequestHandled={(request) => {
            deliveredFocusRequest = request;
            consoleSurface.acknowledgeFocusRequest(request);
          }}
          workspaceOwnerKey="workspace-a"
        />
      ) : null;
    }

    act(() => root.render(<Harness />));
    expect(host.querySelector('textarea[aria-label="Debug expression"]')).toBeNull();

    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "y",
      metaKey: true,
      shiftKey: true,
    });
    act(() => window.dispatchEvent(event));

    const textarea = host.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Debug expression"]',
    );
    expect(event.defaultPrevented).toBe(true);
    expect(deliveredFocusRequest).toEqual({ generation: 1, workspaceOwnerKey: "workspace-a" });
    expect(captured.current?.focusRequest).toBeNull();
    expect(document.activeElement).toBe(textarea);
    expect(consoleResult.submit).not.toHaveBeenCalled();
    expect(consoleResult.clear).not.toHaveBeenCalled();

    act(() => root.unmount());
    host.remove();
  });
});
