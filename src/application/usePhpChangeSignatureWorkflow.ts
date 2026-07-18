import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PhpChangeSignaturePreview } from "../domain/phpChangeSignature";
import {
  newPhpChangeSignatureRow,
  type PhpChangeSignatureFormRow,
} from "../domain/phpChangeSignatureForm";
import {
  PhpChangeSignatureWorkflow,
  type PhpChangeSignaturePreparedSession,
  type PhpChangeSignatureWorkspaceEditApplier,
  type PhpChangeSignatureWorkflowPorts,
} from "./phpChangeSignatureWorkflow";

export interface PhpChangeSignatureDialogState {
  affectedFiles: readonly string[];
  error: string | null;
  isApplying: boolean;
  isLoading: boolean;
  isOpen: boolean;
  invalidRowId?: string | null;
  preview: PhpChangeSignaturePreview | null;
  rows: readonly PhpChangeSignatureFormRow[];
}

export function usePhpChangeSignatureWorkflow(
  ports: PhpChangeSignatureWorkflowPorts,
) {
  const workflow = useMemo(
    () => new PhpChangeSignatureWorkflow(ports),
    [ports],
  );
  const [session, setSession] =
    useState<PhpChangeSignaturePreparedSession | null>(null);
  const [rows, setRows] = useState<readonly PhpChangeSignatureFormRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [nextRow, setNextRow] = useState(1);
  const requestSequenceRef = useRef(0);
  const applyingRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(
    () => () => {
      mountedRef.current = false;
      requestSequenceRef.current += 1;
    },
    [],
  );

  const close = useCallback(() => {
    if (applyingRef.current) return;
    requestSequenceRef.current += 1;
    setIsOpen(false);
    setSession(null);
    setRows([]);
    setError(null);
  }, []);

  const open = useCallback(
    async (
      request: { offset: number; path: string; rootPath: string },
      applyWorkspaceEdit?: PhpChangeSignatureWorkspaceEditApplier,
    ) => {
      const requestSequence = requestSequenceRef.current + 1;
      requestSequenceRef.current = requestSequence;
      setIsOpen(true);
      setIsLoading(true);
      setError(null);
      setSession(null);
      setRows([]);
      const prepared = await workflow.prepare({
        ...request,
        applyWorkspaceEdit,
      });
      if (
        !mountedRef.current ||
        requestSequenceRef.current !== requestSequence
      ) {
        return;
      }
      setIsLoading(false);
      if ("kind" in prepared) {
        setError(prepared.message);
        return;
      }
      setSession(prepared);
      setRows(prepared.rows);
    },
    [workflow],
  );

  const updateRows = useCallback(
    (next: readonly PhpChangeSignatureFormRow[]) => {
      setRows(next);
      if (!session) return;
      const plan = workflow.plan(session, next);
      setError(plan.kind === "ready" ? null : plan.message);
    },
    [session, workflow],
  );

  const addRow = useCallback(() => {
    updateRows([...rows, newPhpChangeSignatureRow(nextRow)]);
    setNextRow((value) => value + 1);
  }, [nextRow, rows, updateRows]);

  const apply = useCallback(async () => {
    if (!session || applyingRef.current) return;
    applyingRef.current = true;
    setIsApplying(true);
    const result = await workflow.apply(session, rows);
    applyingRef.current = false;
    if (!mountedRef.current) return;
    setIsApplying(false);
    if (result.kind !== "applied") {
      setError(result.message);
      return;
    }
    setIsOpen(false);
    setSession(null);
    setRows([]);
    setError(null);
  }, [rows, session, workflow]);

  const currentRootPath = ports.currentRootPath();
  const workspaceTrusted = ports.isWorkspaceTrusted();

  useEffect(() => {
    if (!session || applyingRef.current) return;
    if (currentRootPath === session.rootPath && workspaceTrusted) return;
    requestSequenceRef.current += 1;
    setIsOpen(false);
    setSession(null);
    setRows([]);
    setError(null);
  }, [currentRootPath, session, workspaceTrusted]);

  useEffect(() => {
    if (!session || applyingRef.current) return;
    const affectedOpenPaths = new Set(
      session.documents
        .filter((document) => document.version !== null)
        .map((document) => document.path),
    );
    return ports.subscribeChangedDocuments((paths) => {
      if (!paths.some((path) => affectedOpenPaths.has(path))) return;
      requestSequenceRef.current += 1;
      setIsOpen(false);
      setSession(null);
      setRows([]);
      setError(null);
    });
  }, [ports, session]);

  const plan = session ? workflow.plan(session, rows) : null;
  const state: PhpChangeSignatureDialogState = {
    affectedFiles: session
      ? [...new Set(session.documents.map((document) => document.path))]
      : [],
    error,
    isApplying,
    isLoading,
    isOpen,
    invalidRowId: plan?.kind === "invalid" ? (plan.rowId ?? null) : null,
    preview: plan?.kind === "ready" ? plan.preview : null,
    rows,
  };

  return { addRow, apply, close, open, state, updateRows };
}
