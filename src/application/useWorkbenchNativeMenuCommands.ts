import { isTauri } from "@tauri-apps/api/core";
import {
  listen,
  type UnlistenFn as TauriUnlistenFn,
} from "@tauri-apps/api/event";
import { useEffect, useLayoutEffect, useRef } from "react";
import { createSafeUnsubscribe } from "../infrastructure/safeUnsubscribe";
import type {
  CommandContext,
  CommandExecutionRunner,
} from "./commandRegistry";
import {
  dispatchNativeMenuCommand,
  NATIVE_MENU_EVENT_NAMES,
} from "./workbenchNativeMenuCommandDispatcher";

interface UseWorkbenchNativeMenuCommandsOptions {
  commandContext: CommandContext;
  reportError: (source: string, error: unknown) => void;
  runCommand: CommandExecutionRunner;
}

export function useWorkbenchNativeMenuCommands({
  commandContext,
  reportError,
  runCommand,
}: UseWorkbenchNativeMenuCommandsOptions): void {
  const dispatchRef = useRef({ commandContext, runCommand });

  useLayoutEffect(() => {
    dispatchRef.current = { commandContext, runCommand };
  }, [commandContext, runCommand]);

  useEffect(() => {
    if (!isTauri()) {
      return;
    }

    let active = true;
    const unlisteners: TauriUnlistenFn[] = [];

    NATIVE_MENU_EVENT_NAMES.forEach((eventName) => {
      listen(eventName, () => {
        if (!active) {
          return;
        }

        dispatchNativeMenuCommand({
          ...dispatchRef.current,
          eventName,
        });
      })
        .then((dispose) => {
          if (!active) {
            dispose();
            return;
          }

          unlisteners.push(createSafeUnsubscribe(dispose));
        })
        .catch((error) => reportError("Shortcuts", error));
    });

    return () => {
      active = false;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [reportError]);
}
