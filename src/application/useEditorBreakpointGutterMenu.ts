import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type * as Monaco from "monaco-editor";
import type {
  Breakpoint,
  BreakpointCreationOwnership,
  BreakpointHitCondition,
} from "../domain/debug";
import {
  debugBreakpointConditionError,
  debugBreakpointConditionValue,
  debugBreakpointGutterCapabilities,
  debugBreakpointGutterMenuItems,
  type DebugBreakpointGutterCapabilities,
  type DebugBreakpointGutterMenuItem,
} from "../domain/debugBreakpointGutterMenu";
import {
  breakpointHitConditionError,
  parseBreakpointHitCondition,
} from "../domain/debugBreakpointHitCondition";
import {
  breakpointLogMessageError,
  isBreakpointLogMessage,
} from "../domain/debugBreakpointLogMessage";

export interface EditorBreakpointGutterActions {
  removeBreakpoint(id: string): void | Promise<void>;
  setBreakpointCondition(id: string, condition: string | null): void | Promise<void>;
  setBreakpointEnabled(id: string, enabled: boolean): void | Promise<void>;
  setBreakpointHitCondition(
    id: string,
    hitCondition: BreakpointHitCondition | null,
  ): void | Promise<void>;
  setBreakpointLogMessage(id: string, logMessage: string | null): void | Promise<void>;
  toggleBreakpoint(
    filePath: string,
    lineNumber: number,
  ): void | BreakpointCreationOwnership | Promise<void | BreakpointCreationOwnership | null> | null;
}

export type EditorBreakpointGutterEditorKind = "conditional" | "hitCondition" | "logpoint";

export interface EditorBreakpointGutterRequest {
  readonly anchor: { readonly x: number; readonly y: number };
  readonly breakpointId: string | null;
  readonly capabilities: DebugBreakpointGutterCapabilities;
  readonly columnNumber: number | undefined;
  readonly filePath: string;
  readonly lineNumber: number;
  readonly model: Monaco.editor.ITextModel;
  readonly modelVersion: number;
  readonly mutationOwnerIdentity: object;
  readonly origin: Monaco.IPosition;
  readonly view: "menu" | EditorBreakpointGutterEditorKind;
  readonly workspaceRoot: string;
}

export interface EditorBreakpointGutterEditorValues {
  readonly condition: string;
  readonly hitCondition: string;
  readonly logMessage: string;
}

interface Options {
  readonly actions?: Partial<EditorBreakpointGutterActions>;
  readonly activeDocumentPath: string | undefined;
  readonly breakpoints: readonly Breakpoint[];
  readonly editor: Monaco.editor.IStandaloneCodeEditor | null;
  readonly modelIdentity: Monaco.editor.ITextModel | null;
  readonly monaco: typeof Monaco | null;
  readonly onMutationError?: (error: unknown) => void;
  readonly toggleBreakpointFallback?: EditorBreakpointGutterActions["toggleBreakpoint"];
  readonly workspaceRoot: string | null;
}

interface ContextSnapshot extends Omit<
  Options,
  "monaco" | "onMutationError" | "toggleBreakpointFallback"
> {
  readonly mutationOwnerIdentity: object | null;
}

export type EditorBreakpointGutterDiscardReason =
  "actionUnavailable" | "authorityLost" | "documentChanged" | "invalidInput";

export class EditorBreakpointGutterMutationDiscardError extends Error {
  readonly code: EditorBreakpointGutterDiscardReason;

  constructor(code: EditorBreakpointGutterDiscardReason) {
    const messages: Record<EditorBreakpointGutterDiscardReason, string> = {
      actionUnavailable: "The breakpoint action is no longer available.",
      authorityLost: "The breakpoint action was dropped because its owner changed.",
      documentChanged: "The breakpoint action was dropped because the document changed.",
      invalidInput: "The breakpoint action was dropped because its value is invalid.",
    };
    super(messages[code]);
    this.code = code;
    this.name = "EditorBreakpointGutterMutationDiscardError";
  }
}

function glyphMarginLane(event: Monaco.editor.IEditorMouseEvent) {
  const target = event.target as {
    detail?: { glyphMarginLane?: Monaco.editor.GlyphMarginLane };
  };
  return target.detail?.glyphMarginLane ?? null;
}

export function useEditorBreakpointGutterMenu(options: Options) {
  const {
    actions: providedActions,
    activeDocumentPath,
    breakpoints,
    editor,
    modelIdentity,
    monaco,
    onMutationError,
    toggleBreakpointFallback,
    workspaceRoot,
  } = options;
  const hasProvidedActions = Boolean(providedActions);
  const removeBreakpoint = providedActions?.removeBreakpoint;
  const setBreakpointCondition = providedActions?.setBreakpointCondition;
  const setBreakpointEnabled = providedActions?.setBreakpointEnabled;
  const setBreakpointHitCondition = providedActions?.setBreakpointHitCondition;
  const setBreakpointLogMessage = providedActions?.setBreakpointLogMessage;
  const toggleBreakpoint = providedActions?.toggleBreakpoint;
  const actions = useMemo(
    () =>
      hasProvidedActions || toggleBreakpointFallback
        ? {
            removeBreakpoint,
            setBreakpointCondition,
            setBreakpointEnabled,
            setBreakpointHitCondition,
            setBreakpointLogMessage,
            toggleBreakpoint: toggleBreakpoint ?? toggleBreakpointFallback,
          }
        : undefined,
    [
      hasProvidedActions,
      removeBreakpoint,
      setBreakpointCondition,
      setBreakpointEnabled,
      setBreakpointHitCondition,
      setBreakpointLogMessage,
      toggleBreakpoint,
      toggleBreakpointFallback,
    ],
  );
  const [request, setRequest] = useState<EditorBreakpointGutterRequest | null>(null);
  const requestRef = useRef(request);
  const dismissRef = useRef(0);
  const popoverId = useId();
  requestRef.current = request;
  const mutationOwnerIdentity = useMemo(() => (actions ? {} : null), [actions]);
  const capabilities = useMemo(() => {
    if (!workspaceRoot || !activeDocumentPath) return null;
    const available = debugBreakpointGutterCapabilities(workspaceRoot, activeDocumentPath);
    return {
      breakpoints: available.breakpoints,
      hitConditions: available.hitConditions && Boolean(actions?.setBreakpointHitCondition),
      logpoints: available.logpoints && Boolean(actions?.setBreakpointLogMessage),
    };
  }, [
    actions?.setBreakpointHitCondition,
    actions?.setBreakpointLogMessage,
    activeDocumentPath,
    workspaceRoot,
  ]);
  const contextRef = useRef<ContextSnapshot>({
    actions,
    activeDocumentPath,
    breakpoints,
    editor,
    modelIdentity,
    mutationOwnerIdentity,
    workspaceRoot,
  });
  contextRef.current = {
    actions,
    activeDocumentPath,
    breakpoints,
    editor,
    modelIdentity,
    mutationOwnerIdentity,
    workspaceRoot,
  };

  const reportMutationError = useCallback(
    (error: unknown) => {
      try {
        onMutationError?.(error);
      } catch {
        return;
      }
    },
    [onMutationError],
  );

  const discard = useCallback(
    (reason: EditorBreakpointGutterDiscardReason) => {
      reportMutationError(new EditorBreakpointGutterMutationDiscardError(reason));
      return false;
    },
    [reportMutationError],
  );

  const restoreEditorFocus = useCallback((current: EditorBreakpointGutterRequest) => {
    const context = contextRef.current;
    if (context.editor?.getModel() !== current.model) return;
    if (context.activeDocumentPath !== current.filePath) return;
    context.editor.setPosition(current.origin);
    context.editor.focus();
  }, []);

  const close = useCallback(
    (restoreFocus: boolean) => {
      dismissRef.current += 1;
      const current = requestRef.current;
      if (current && restoreFocus) restoreEditorFocus(current);
      requestRef.current = null;
      setRequest(null);
    },
    [restoreEditorFocus],
  );

  const open = useCallback(
    (
      lineNumber: number,
      anchor: { readonly x: number; readonly y: number },
      columnNumber?: number,
    ) => {
      const model = editor?.getModel();
      const origin = editor?.getPosition();
      if (!editor || !model || model !== modelIdentity || !origin) return false;
      if (!workspaceRoot || !mutationOwnerIdentity || !capabilities?.breakpoints) return false;
      if (!activeDocumentPath || lineNumber < 1 || lineNumber > model.getLineCount()) return false;
      const breakpoint =
        breakpoints.find(
          (candidate) =>
            candidate.filePath === activeDocumentPath &&
            candidate.lineNumber === lineNumber &&
            candidate.columnNumber === columnNumber,
        ) ?? null;
      if (columnNumber !== undefined && !breakpoint) return false;
      if (debugBreakpointGutterMenuItems(breakpoint, capabilities).length === 0) return false;
      const nextRequest: EditorBreakpointGutterRequest = {
        anchor,
        breakpointId: breakpoint?.id ?? null,
        capabilities,
        columnNumber,
        filePath: activeDocumentPath,
        lineNumber,
        model,
        modelVersion: model.getVersionId(),
        mutationOwnerIdentity,
        origin: { column: origin.column, lineNumber: origin.lineNumber },
        view: "menu",
        workspaceRoot,
      };
      requestRef.current = nextRequest;
      setRequest(nextRequest);
      return true;
    },
    [
      activeDocumentPath,
      breakpoints,
      capabilities,
      editor,
      modelIdentity,
      mutationOwnerIdentity,
      workspaceRoot,
    ],
  );

  useEffect(() => {
    if (!editor || !monaco) return;
    const mouse = editor.onMouseDown((event) => {
      if (!event.event.rightButton || !event.target.position) return;
      const lineNumbers = event.target.type === monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS;
      const leftGlyph =
        event.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN &&
        glyphMarginLane(event) === monaco.editor.GlyphMarginLane.Left;
      const inlineBreakpoint =
        lineNumbers || leftGlyph
          ? null
          : (breakpoints.find(
              (candidate) =>
                candidate.filePath === activeDocumentPath &&
                candidate.lineNumber === event.target.position?.lineNumber &&
                candidate.columnNumber !== undefined &&
                candidate.columnNumber === event.target.position.column,
            ) ?? null);
      if (!lineNumbers && !leftGlyph && !inlineBreakpoint) return;
      const opened = open(
        event.target.position.lineNumber,
        { x: event.event.posx, y: event.event.posy },
        inlineBreakpoint?.columnNumber,
      );
      if (!opened) return;
      event.event.preventDefault();
      event.event.stopPropagation();
    });
    const keyboard = editor.onKeyDown((event) => {
      const browserEvent = event.browserEvent;
      const contextMenuKey = browserEvent.key === "ContextMenu";
      const shiftedF10 = browserEvent.key === "F10" && browserEvent.shiftKey;
      if (!contextMenuKey && !shiftedF10) return;
      const position = editor.getPosition();
      if (!position) return;
      const visible = editor.getScrolledVisiblePosition(position);
      const bounds = editor.getDomNode()?.getBoundingClientRect();
      const opened = open(position.lineNumber, {
        x: (bounds?.left ?? 0) + (visible?.left ?? 8),
        y: (bounds?.top ?? 0) + (visible?.top ?? 8) + (visible?.height ?? 18),
      });
      if (!opened) return;
      event.preventDefault();
      event.stopPropagation();
    });
    const modelChange = editor.onDidChangeModel(() => close(false));
    return () => {
      keyboard.dispose();
      modelChange.dispose();
      mouse.dispose();
    };
  }, [activeDocumentPath, breakpoints, close, editor, monaco, open]);

  useEffect(() => {
    close(false);
  }, [activeDocumentPath, close, modelIdentity, mutationOwnerIdentity, workspaceRoot]);

  useEffect(() => {
    if (!request) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return close(false);
      const popover = event.target.closest("[data-editor-breakpoint-gutter-menu]");
      if (popover?.getAttribute("data-editor-breakpoint-gutter-menu") === popoverId) return;
      close(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [close, popoverId, request]);

  const authorityFailure = useCallback(
    (current: EditorBreakpointGutterRequest, expectBreakpoint: boolean) => {
      const context = contextRef.current;
      const model = context.editor?.getModel();
      if (!model || model !== current.model || model !== context.modelIdentity) {
        return "documentChanged" as const;
      }
      if (model.getVersionId() !== current.modelVersion) return "documentChanged" as const;
      if (current.lineNumber < 1 || current.lineNumber > model.getLineCount()) {
        return "documentChanged" as const;
      }
      if (
        context.activeDocumentPath !== current.filePath ||
        context.workspaceRoot !== current.workspaceRoot ||
        context.mutationOwnerIdentity !== current.mutationOwnerIdentity
      ) {
        return "authorityLost" as const;
      }
      const exactBreakpoint = context.breakpoints.find(
        (candidate) =>
          candidate.id === current.breakpointId &&
          candidate.filePath === current.filePath &&
          candidate.lineNumber === current.lineNumber &&
          candidate.columnNumber === current.columnNumber,
      );
      if (expectBreakpoint && !exactBreakpoint) return "authorityLost" as const;
      if (
        !expectBreakpoint &&
        (current.breakpointId !== null ||
          context.breakpoints.some(
            (candidate) =>
              candidate.filePath === current.filePath &&
              candidate.lineNumber === current.lineNumber &&
              candidate.columnNumber === current.columnNumber,
          ))
      ) {
        return "authorityLost" as const;
      }
      return null;
    },
    [],
  );

  const documentAuthorityFailure = useCallback((current: EditorBreakpointGutterRequest) => {
    const context = contextRef.current;
    const model = context.editor?.getModel();
    if (
      !model ||
      model !== current.model ||
      model !== context.modelIdentity ||
      model.getVersionId() !== current.modelVersion ||
      current.lineNumber < 1 ||
      current.lineNumber > model.getLineCount()
    ) {
      return "documentChanged" as const;
    }
    if (
      context.activeDocumentPath !== current.filePath ||
      context.workspaceRoot !== current.workspaceRoot ||
      context.mutationOwnerIdentity !== current.mutationOwnerIdentity
    ) {
      return "authorityLost" as const;
    }
    return null;
  }, []);

  const rollback = useCallback(
    async (ownership: void | BreakpointCreationOwnership | null) => {
      if (!ownership) return;
      try {
        await ownership.rollback();
      } catch (error) {
        reportMutationError(error);
      }
    },
    [reportMutationError],
  );

  const addBreakpoint = useCallback(
    async (current: EditorBreakpointGutterRequest, values?: EditorBreakpointGutterEditorValues) => {
      const initialFailure = authorityFailure(current, false);
      if (initialFailure) return discard(initialFailure);
      const currentActions = contextRef.current.actions;
      const toggle = currentActions?.toggleBreakpoint;
      if (!toggle) return discard("actionUnavailable");
      const setter =
        current.view === "conditional"
          ? currentActions.setBreakpointCondition
          : current.view === "hitCondition"
            ? currentActions.setBreakpointHitCondition
            : current.view === "logpoint"
              ? currentActions.setBreakpointLogMessage
              : null;
      if (values && !setter) return discard("actionUnavailable");
      let ownership: void | BreakpointCreationOwnership | null = null;
      try {
        ownership = await toggle(current.filePath, current.lineNumber);
        const postToggleFailure = documentAuthorityFailure(current);
        if (postToggleFailure || (ownership && !ownership.isCurrent())) {
          await rollback(ownership);
          return discard(postToggleFailure ?? "authorityLost");
        }
        if (!values) return true;
        if (!ownership) return discard("authorityLost");
        const value =
          current.view === "conditional"
            ? debugBreakpointConditionValue(values.condition)
            : current.view === "hitCondition"
              ? parseBreakpointHitCondition(values.hitCondition)
              : isBreakpointLogMessage(values.logMessage)
                ? values.logMessage
                : null;
        const invalid =
          (current.view === "conditional" &&
            (!value || debugBreakpointConditionError(values.condition.trim()))) ||
          (current.view === "hitCondition" &&
            (!value || breakpointHitConditionError(values.hitCondition))) ||
          (current.view === "logpoint" && (!value || breakpointLogMessageError(values.logMessage)));
        if (invalid) {
          await rollback(ownership);
          return discard("invalidInput");
        }
        const preMutationFailure = documentAuthorityFailure(current);
        if (preMutationFailure || !ownership.isCurrent()) {
          await rollback(ownership);
          return discard(preMutationFailure ?? "authorityLost");
        }
        await setter?.(ownership.breakpointId, value as never);
        const postMutationFailure = documentAuthorityFailure(current);
        if (postMutationFailure || !ownership.isCurrent()) {
          await rollback(ownership);
          return discard(postMutationFailure ?? "authorityLost");
        }
        return true;
      } catch (error) {
        await rollback(ownership);
        reportMutationError(error);
        return false;
      }
    },
    [authorityFailure, discard, documentAuthorityFailure, reportMutationError, rollback],
  );

  const mutateExisting = useCallback(
    async (current: EditorBreakpointGutterRequest, values: EditorBreakpointGutterEditorValues) => {
      const failure = authorityFailure(current, true);
      if (failure || !current.breakpointId) return discard(failure ?? "authorityLost");
      const currentActions = contextRef.current.actions;
      try {
        if (current.view === "conditional") {
          const condition = debugBreakpointConditionValue(values.condition);
          if (debugBreakpointConditionError(values.condition.trim())) {
            return discard("invalidInput");
          }
          if (!currentActions?.setBreakpointCondition) return discard("actionUnavailable");
          await currentActions.setBreakpointCondition(current.breakpointId, condition);
        }
        if (current.view === "hitCondition") {
          if (breakpointHitConditionError(values.hitCondition)) return discard("invalidInput");
          if (!currentActions?.setBreakpointHitCondition) return discard("actionUnavailable");
          await currentActions.setBreakpointHitCondition(
            current.breakpointId,
            parseBreakpointHitCondition(values.hitCondition),
          );
        }
        if (current.view === "logpoint") {
          if (breakpointLogMessageError(values.logMessage)) return discard("invalidInput");
          if (!currentActions?.setBreakpointLogMessage) return discard("actionUnavailable");
          const logMessage = isBreakpointLogMessage(values.logMessage) ? values.logMessage : null;
          await currentActions.setBreakpointLogMessage(current.breakpointId, logMessage);
        }
        return true;
      } catch (error) {
        reportMutationError(error);
        return false;
      }
    },
    [authorityFailure, discard, reportMutationError],
  );

  const selectMenuItem = useCallback(
    (item: DebugBreakpointGutterMenuItem) => {
      const current = requestRef.current;
      if (!current) return;
      const editorKind =
        item.id === "addConditional" || item.id === "editConditional"
          ? "conditional"
          : item.id === "addHitCondition" || item.id === "editHitCondition"
            ? "hitCondition"
            : item.id === "addLogpoint" || item.id === "editLogpoint"
              ? "logpoint"
              : null;
      if (editorKind) {
        const nextRequest: EditorBreakpointGutterRequest = { ...current, view: editorKind };
        requestRef.current = nextRequest;
        setRequest(nextRequest);
        return;
      }
      close(false);
      const seq = dismissRef.current;
      const run = async () => {
        if (item.id === "add") {
          await addBreakpoint(current);
          if (dismissRef.current !== seq) return;
          restoreEditorFocus(current);
          return;
        }
        const failure = authorityFailure(current, true);
        if (failure || !current.breakpointId) {
          discard(failure ?? "authorityLost");
          restoreEditorFocus(current);
          return;
        }
        try {
          const currentActions = contextRef.current.actions;
          if (item.id === "remove") {
            if (!currentActions?.removeBreakpoint) discard("actionUnavailable");
            await currentActions?.removeBreakpoint?.(current.breakpointId);
            if (dismissRef.current !== seq) return;
          }
          if (item.id === "removeLogpoint") {
            if (!currentActions?.setBreakpointLogMessage) discard("actionUnavailable");
            await currentActions?.setBreakpointLogMessage?.(current.breakpointId, null);
            if (dismissRef.current !== seq) return;
          }
          if (item.id === "disable") {
            if (!currentActions?.setBreakpointEnabled) discard("actionUnavailable");
            await currentActions?.setBreakpointEnabled?.(current.breakpointId, false);
            if (dismissRef.current !== seq) return;
          }
          if (item.id === "enable") {
            if (!currentActions?.setBreakpointEnabled) discard("actionUnavailable");
            await currentActions?.setBreakpointEnabled?.(current.breakpointId, true);
            if (dismissRef.current !== seq) return;
          }
        } catch (error) {
          reportMutationError(error);
        }
        if (dismissRef.current !== seq) return;
        restoreEditorFocus(current);
      };
      void run();
    },
    [addBreakpoint, authorityFailure, close, discard, reportMutationError, restoreEditorFocus],
  );

  const save = useCallback(
    async (values: EditorBreakpointGutterEditorValues) => {
      const current = requestRef.current;
      if (!current || current.view === "menu") return false;
      const seq = dismissRef.current;
      const saved = current.breakpointId
        ? await mutateExisting(current, values)
        : await addBreakpoint(current, values);
      if (dismissRef.current !== seq) return saved;
      if (!saved) {
        if (authorityFailure(current, current.breakpointId !== null)) close(false);
        return false;
      }
      close(false);
      restoreEditorFocus(current);
      return true;
    },
    [addBreakpoint, authorityFailure, close, mutateExisting, restoreEditorFocus],
  );

  const currentBreakpoint =
    breakpoints.find((candidate) => candidate.id === request?.breakpointId) ?? null;
  const items = request
    ? debugBreakpointGutterMenuItems(currentBreakpoint, request.capabilities)
    : [];
  return {
    close,
    currentBreakpoint,
    items,
    popoverId,
    request,
    save,
    selectMenuItem,
  };
}
