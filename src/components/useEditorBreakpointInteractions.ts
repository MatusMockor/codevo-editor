import { useCallback, useEffect, useRef, useState } from "react";
import type { Breakpoint, BreakpointCreationOwnership } from "../domain/debug";
import type { BreakpointHitCondition } from "../domain/debug";
import {
  breakpointHitConditionError,
  parseBreakpointHitCondition,
} from "../domain/debugBreakpointHitCondition";
import {
  breakpointLogMessageError,
  isBreakpointLogMessage,
} from "../domain/debugBreakpointLogMessage";
import {
  MAX_DEBUG_BREAKPOINT_CONDITION_BYTES,
  utf8ByteLength,
} from "../domain/debugBreakpointPolicy";

export interface BreakpointPopoverRequest {
  readonly anchor: { readonly x: number; readonly y: number };
  readonly breakpoint: Breakpoint | null;
  readonly columnNumber?: number;
  readonly filePath: string;
  readonly kind: "menu" | "editor";
  readonly editKind: "condition" | "hitCondition" | "logMessage";
  readonly hitConditionSupported: boolean;
  readonly logMessageSupported: boolean;
  readonly lineNumber: number;
  readonly operationToken: number;
}

interface Options {
  readonly activeDocumentPath: string | undefined;
  readonly breakpoints: readonly Breakpoint[];
  readonly modelIdentity: object | null;
  readonly hitConditionSupported?: boolean;
  readonly logMessageSupported?: boolean;
  readonly onMutationError?: (error: unknown) => void;
  readonly onRemoveBreakpoint?: (id: string) => void | Promise<void>;
  readonly onSetBreakpointCondition?: (
    id: string,
    condition: string | null,
  ) => void | Promise<void>;
  readonly onSetBreakpointHitCondition?: (
    id: string,
    hitCondition: BreakpointHitCondition | null,
  ) => void | Promise<void>;
  readonly onSetBreakpointLogMessage?: (
    id: string,
    logMessage: string | null,
  ) => void | Promise<void>;
  readonly onToggleBreakpoint?: (
    filePath: string,
    lineNumber: number,
  ) =>
    void | BreakpointCreationOwnership | Promise<void | BreakpointCreationOwnership | null> | null;
  readonly restoreFocus?: () => void;
  readonly workspaceRoot: string | null;
}

interface PendingConditionOperation {
  readonly condition: string;
  readonly editKind: "condition" | "hitCondition" | "logMessage";
  readonly filePath: string;
  readonly key: string;
  readonly lineNumber: number;
  readonly modelIdentity: object;
  readonly hitCondition: BreakpointHitCondition | null;
  readonly logMessage: string | null;
  readonly popoverToken: number;
  readonly resolve: (applied: boolean) => void;
  readonly token: number;
  readonly workspaceRoot: string;
  applying: boolean;
  toggleDone: boolean;
  ownership: BreakpointCreationOwnership | null;
}

export function useEditorBreakpointInteractions({
  activeDocumentPath,
  breakpoints,
  modelIdentity,
  hitConditionSupported = false,
  logMessageSupported = false,
  onMutationError,
  onRemoveBreakpoint,
  onSetBreakpointCondition,
  onSetBreakpointHitCondition,
  onSetBreakpointLogMessage,
  onToggleBreakpoint,
  restoreFocus,
  workspaceRoot,
}: Options) {
  const [popover, setPopover] = useState<BreakpointPopoverRequest | null>(null);
  const pendingOperationsRef = useRef(new Map<string, PendingConditionOperation>());
  const nextOperationTokenRef = useRef(1);
  const nextPopoverTokenRef = useRef(1);
  const activePopoverTokenRef = useRef<number | null>(null);
  const previousContextRef = useRef({ activeDocumentPath, modelIdentity, workspaceRoot });
  const currentContextRef = useRef({ activeDocumentPath, modelIdentity, workspaceRoot });
  currentContextRef.current = { activeDocumentPath, modelIdentity, workspaceRoot };
  const mountedRef = useRef(true);
  const reportMutationError = useCallback(
    (error: unknown) => {
      try {
        onMutationError?.(error);
      } catch {
        // Reporting is best effort and must not create another unhandled rejection.
      }
    },
    [onMutationError],
  );

  const cancelOperation = useCallback((operation: PendingConditionOperation) => {
    if (pendingOperationsRef.current.get(operation.key)?.token !== operation.token) return;
    pendingOperationsRef.current.delete(operation.key);
    operation.resolve(false);
  }, []);

  const invalidatePopover = useCallback(
    (token: number | null) => {
      if (token === null || activePopoverTokenRef.current !== token) return;
      activePopoverTokenRef.current = null;
      setPopover(null);
      for (const operation of pendingOperationsRef.current.values()) {
        if (operation.popoverToken === token) cancelOperation(operation);
      }
    },
    [cancelOperation],
  );

  const close = useCallback(() => {
    invalidatePopover(activePopoverTokenRef.current);
    restoreFocus?.();
  }, [invalidatePopover, restoreFocus]);

  useEffect(() => {
    const previous = previousContextRef.current;
    previousContextRef.current = { activeDocumentPath, modelIdentity, workspaceRoot };
    if (
      previous.activeDocumentPath === activeDocumentPath &&
      previous.modelIdentity === modelIdentity &&
      previous.workspaceRoot === workspaceRoot
    ) {
      return;
    }
    invalidatePopover(activePopoverTokenRef.current);
    for (const operation of pendingOperationsRef.current.values()) {
      if (
        operation.filePath !== activeDocumentPath ||
        operation.modelIdentity !== modelIdentity ||
        operation.workspaceRoot !== workspaceRoot
      ) {
        cancelOperation(operation);
      }
    }
  }, [activeDocumentPath, cancelOperation, invalidatePopover, modelIdentity, workspaceRoot]);

  useEffect(() => {
    mountedRef.current = true;
    const operations = pendingOperationsRef.current;
    return () => {
      mountedRef.current = false;
      activePopoverTokenRef.current = null;
      for (const operation of operations.values()) operation.resolve(false);
      operations.clear();
    };
  }, []);

  const open = useCallback(
    (
      filePath: string,
      lineNumber: number,
      anchor: { x: number; y: number },
      columnNumber?: number,
    ) => {
      if (
        !workspaceRoot ||
        !modelIdentity ||
        filePath !== activeDocumentPath ||
        !onToggleBreakpoint ||
        !onSetBreakpointCondition
      ) {
        return;
      }
      invalidatePopover(activePopoverTokenRef.current);
      const breakpoint =
        breakpoints.find(
          (candidate) =>
            candidate.filePath === filePath &&
            candidate.lineNumber === lineNumber &&
            candidate.columnNumber === columnNumber,
        ) ?? null;
      // Content interactions edit an existing exact inline breakpoint only;
      // line creation remains owned by the gutter interaction.
      if (columnNumber !== undefined && breakpoint === null) return;
      const operationToken = nextPopoverTokenRef.current++;
      activePopoverTokenRef.current = operationToken;
      setPopover({
        anchor,
        breakpoint,
        ...(columnNumber === undefined ? {} : { columnNumber }),
        filePath,
        kind: "menu",
        editKind: "condition",
        hitConditionSupported,
        logMessageSupported,
        lineNumber,
        operationToken,
      });
    },
    [
      activeDocumentPath,
      breakpoints,
      modelIdentity,
      hitConditionSupported,
      logMessageSupported,
      invalidatePopover,
      onSetBreakpointCondition,
      onToggleBreakpoint,
      workspaceRoot,
    ],
  );

  const edit = useCallback(
    (editKind: "condition" | "hitCondition" | "logMessage" = "condition") => {
      setPopover((current) => (current ? { ...current, editKind, kind: "editor" } : null));
    },
    [],
  );

  const remove = useCallback(() => {
    const current = popover;
    if (!current?.breakpoint || !onRemoveBreakpoint) return;
    invalidatePopover(current.operationToken);
    void Promise.resolve(onRemoveBreakpoint(current.breakpoint.id)).catch(reportMutationError);
    restoreFocus?.();
  }, [invalidatePopover, onRemoveBreakpoint, popover, reportMutationError, restoreFocus]);

  const removeLogpoint = useCallback(() => {
    const current = popover;
    if (!current?.breakpoint?.logMessage || !onSetBreakpointLogMessage) return;
    invalidatePopover(current.operationToken);
    void Promise.resolve(onSetBreakpointLogMessage(current.breakpoint.id, null)).catch(
      reportMutationError,
    );
    restoreFocus?.();
  }, [invalidatePopover, onSetBreakpointLogMessage, popover, reportMutationError, restoreFocus]);

  const save = useCallback(
    async (rawCondition: string): Promise<boolean> => {
      const current = popover;
      if (!current || !modelIdentity || !workspaceRoot) return false;
      const popoverToken = current.operationToken;
      const contextIsCurrent = () => {
        const context = currentContextRef.current;
        return (
          mountedRef.current &&
          activePopoverTokenRef.current === popoverToken &&
          context.activeDocumentPath === current.filePath &&
          context.modelIdentity === modelIdentity &&
          context.workspaceRoot === workspaceRoot
        );
      };
      const condition = rawCondition.trim();
      const hitCondition =
        current.editKind === "hitCondition" ? parseBreakpointHitCondition(rawCondition) : null;
      const logMessage =
        current.editKind === "logMessage" && isBreakpointLogMessage(rawCondition)
          ? rawCondition
          : null;
      const validationError =
        current.editKind === "condition"
          ? breakpointConditionError(condition)
          : current.editKind === "hitCondition"
            ? breakpointHitConditionError(rawCondition)
            : breakpointLogMessageEditorError(rawCondition, current.breakpoint !== null);
      if (validationError) return false;
      if (current.breakpoint) {
        try {
          await Promise.resolve();
          if (!contextIsCurrent()) return false;
          if (current.editKind === "hitCondition") {
            if (!onSetBreakpointHitCondition) return false;
            await onSetBreakpointHitCondition(current.breakpoint.id, hitCondition);
          } else if (current.editKind === "logMessage") {
            if (!onSetBreakpointLogMessage) return false;
            await onSetBreakpointLogMessage(current.breakpoint.id, logMessage);
          } else {
            await onSetBreakpointCondition?.(
              current.breakpoint.id,
              condition === "" ? null : condition,
            );
          }
          if (!contextIsCurrent()) return false;
          invalidatePopover(popoverToken);
          restoreFocus?.();
          return true;
        } catch (error) {
          reportMutationError(error);
          return false;
        }
      } else if (onToggleBreakpoint) {
        const key = `${workspaceRoot}\0${current.filePath}\0${current.lineNumber}`;
        const superseded = pendingOperationsRef.current.get(key);
        if (superseded) cancelOperation(superseded);
        const applied = new Promise<boolean>((resolve) => {
          const operation: PendingConditionOperation = {
            applying: false,
            condition,
            editKind: current.editKind,
            filePath: current.filePath,
            key,
            lineNumber: current.lineNumber,
            modelIdentity,
            hitCondition,
            logMessage,
            ownership: null,
            popoverToken,
            resolve,
            toggleDone: false,
            token: nextOperationTokenRef.current++,
            workspaceRoot,
          };
          pendingOperationsRef.current.set(key, operation);
          void Promise.resolve(onToggleBreakpoint(current.filePath, current.lineNumber)).then(
            async (ownership) => {
              operation.toggleDone = true;
              operation.ownership = ownership ?? null;
              await new Promise<void>((resume) => window.setTimeout(resume, 0));
              const rollback = async () => {
                if (!operation.ownership) return;
                try {
                  await operation.ownership.rollback();
                } catch {
                  // Local ownership cleanup is authoritative; a later session sync reconciles a
                  // backend that disappeared while the compensating request was in flight.
                }
                operation.ownership = null;
              };
              if (
                pendingOperationsRef.current.get(key)?.token !== operation.token ||
                !contextIsCurrent()
              ) {
                await rollback();
                cancelOperation(operation);
                return;
              }
              if (!operation.ownership?.isCurrent()) {
                await rollback();
                cancelOperation(operation);
                return;
              }
              const createdId = operation.ownership.breakpointId;
              operation.applying = true;
              try {
                if (!contextIsCurrent()) {
                  await rollback();
                  cancelOperation(operation);
                  return;
                }
                if (operation.editKind === "hitCondition" && operation.hitCondition !== null) {
                  if (!onSetBreakpointHitCondition) {
                    await rollback();
                    cancelOperation(operation);
                    return;
                  }
                  await onSetBreakpointHitCondition(createdId, operation.hitCondition);
                } else if (operation.editKind === "logMessage" && operation.logMessage !== null) {
                  if (!onSetBreakpointLogMessage) {
                    await rollback();
                    cancelOperation(operation);
                    return;
                  }
                  await onSetBreakpointLogMessage(createdId, operation.logMessage);
                } else if (operation.editKind === "condition" && operation.condition !== "") {
                  await onSetBreakpointCondition?.(createdId, operation.condition);
                }
                if (
                  pendingOperationsRef.current.get(key)?.token !== operation.token ||
                  !contextIsCurrent()
                ) {
                  await rollback();
                  cancelOperation(operation);
                  return;
                }
                pendingOperationsRef.current.delete(key);
                operation.ownership = null;
                operation.resolve(true);
              } catch (error) {
                reportMutationError(error);
                await rollback();
                cancelOperation(operation);
              }
            },
            (error) => {
              reportMutationError(error);
              cancelOperation(operation);
            },
          );
        });
        const result = await applied;
        if (!result || !contextIsCurrent()) return false;
        invalidatePopover(popoverToken);
        restoreFocus?.();
        return result;
      }
      return false;
    },
    [
      cancelOperation,
      invalidatePopover,
      modelIdentity,
      onSetBreakpointCondition,
      onSetBreakpointHitCondition,
      onSetBreakpointLogMessage,
      onToggleBreakpoint,
      popover,
      reportMutationError,
      restoreFocus,
      workspaceRoot,
    ],
  );

  return { close, edit, open, popover, remove, removeLogpoint, save };
}

export function breakpointConditionError(value: string): string | null {
  if (value.includes("\0")) return "Conditions cannot contain a NUL character.";
  if (utf8ByteLength(value) > MAX_DEBUG_BREAKPOINT_CONDITION_BYTES) {
    return `Conditions must be at most ${MAX_DEBUG_BREAKPOINT_CONDITION_BYTES} UTF-8 bytes.`;
  }
  return null;
}

export function breakpointLogMessageEditorError(value: string, allowEmpty: boolean): string | null {
  const error = breakpointLogMessageError(value);
  if (error) return error;
  if (!allowEmpty && !isBreakpointLogMessage(value)) return "A logpoint message is required.";
  return null;
}
