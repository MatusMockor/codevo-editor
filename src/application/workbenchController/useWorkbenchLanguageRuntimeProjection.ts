import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { LanguageServerPlan } from "../../domain/languageServer";
import type { LanguageServerRuntimeStatus } from "../../domain/languageServerRuntime";
import type { PhpToolAvailability } from "../../domain/workspace";

export interface WorkbenchLanguageRuntimeProjectionState {
  readonly commands: WorkbenchLanguageRuntimeProjectionCommands;
  readonly installingManagedPhpactor: boolean;
  readonly installingManagedTypeScriptLanguageServer: boolean;
  readonly javaScriptTypeScriptLanguageServerPlan: LanguageServerPlan | null;
  readonly javaScriptTypeScriptLanguageServerRuntimeStatus: LanguageServerRuntimeStatus | null;
  readonly javaScriptTypeScriptLanguageServerRuntimeStatusRoot: string | null;
  readonly languageServerPlan: LanguageServerPlan | null;
  readonly languageServerRuntimeStatus: LanguageServerRuntimeStatus | null;
  readonly languageServerRuntimeStatusRoot: string | null;
  readonly languageServerSetupOpen: boolean;
  readonly phpIdeReadinessVersion: number;
  readonly phpTools: PhpToolAvailability | null;
  readonly setInstallingManagedPhpactor: Dispatch<SetStateAction<boolean>>;
  readonly setInstallingManagedTypeScriptLanguageServer: Dispatch<SetStateAction<boolean>>;
  readonly setJavaScriptTypeScriptLanguageServerPlan: Dispatch<
    SetStateAction<LanguageServerPlan | null>
  >;
  readonly setJavaScriptTypeScriptLanguageServerRuntimeStatus: Dispatch<
    SetStateAction<LanguageServerRuntimeStatus | null>
  >;
  readonly setJavaScriptTypeScriptLanguageServerRuntimeStatusRoot: Dispatch<
    SetStateAction<string | null>
  >;
  readonly setLanguageServerPlan: Dispatch<SetStateAction<LanguageServerPlan | null>>;
  readonly setLanguageServerRuntimeStatus: Dispatch<
    SetStateAction<LanguageServerRuntimeStatus | null>
  >;
  readonly setLanguageServerRuntimeStatusRoot: Dispatch<SetStateAction<string | null>>;
  readonly setLanguageServerSetupOpen: Dispatch<SetStateAction<boolean>>;
  readonly setPhpIdeReadinessVersion: Dispatch<SetStateAction<number>>;
  readonly setPhpTools: Dispatch<SetStateAction<PhpToolAvailability | null>>;
}

export interface WorkbenchLanguageRuntimeProjectionCommands {
  bumpPhpIdeReadinessVersion(): void;
  prepareWorkspace(status: LanguageServerRuntimeStatus | null, rootPath: string): void;
  reset(): void;
}

interface WorkbenchLanguageRuntimeProjectionSetters {
  readonly setInstallingManagedPhpactor: Dispatch<SetStateAction<boolean>>;
  readonly setInstallingManagedTypeScriptLanguageServer: Dispatch<SetStateAction<boolean>>;
  readonly setJavaScriptTypeScriptLanguageServerPlan: Dispatch<
    SetStateAction<LanguageServerPlan | null>
  >;
  readonly setJavaScriptTypeScriptLanguageServerRuntimeStatus: Dispatch<
    SetStateAction<LanguageServerRuntimeStatus | null>
  >;
  readonly setJavaScriptTypeScriptLanguageServerRuntimeStatusRoot: Dispatch<
    SetStateAction<string | null>
  >;
  readonly setLanguageServerPlan: Dispatch<SetStateAction<LanguageServerPlan | null>>;
  readonly setLanguageServerRuntimeStatus: Dispatch<
    SetStateAction<LanguageServerRuntimeStatus | null>
  >;
  readonly setLanguageServerRuntimeStatusRoot: Dispatch<SetStateAction<string | null>>;
  readonly setLanguageServerSetupOpen: Dispatch<SetStateAction<boolean>>;
  readonly setPhpIdeReadinessVersion: Dispatch<SetStateAction<number>>;
  readonly setPhpTools: Dispatch<SetStateAction<PhpToolAvailability | null>>;
}

const commandsByProjectionOwner = new WeakMap<
  Dispatch<SetStateAction<PhpToolAvailability | null>>,
  WorkbenchLanguageRuntimeProjectionCommands
>();

export function useWorkbenchLanguageRuntimeProjectionState(): WorkbenchLanguageRuntimeProjectionState {
  const [phpTools, setPhpTools] = useState(null as PhpToolAvailability | null);
  const [languageServerPlan, setLanguageServerPlan] = useState(null as LanguageServerPlan | null);
  const [installingManagedPhpactor, setInstallingManagedPhpactor] = useState(false);
  const [installingManagedTypeScriptLanguageServer, setInstallingManagedTypeScriptLanguageServer] =
    useState(false);
  const [javaScriptTypeScriptLanguageServerPlan, setJavaScriptTypeScriptLanguageServerPlan] =
    useState(null as LanguageServerPlan | null);
  const [languageServerSetupOpen, setLanguageServerSetupOpen] = useState(false);
  const [languageServerRuntimeStatus, setLanguageServerRuntimeStatus] = useState(
    null as LanguageServerRuntimeStatus | null,
  );
  const [languageServerRuntimeStatusRoot, setLanguageServerRuntimeStatusRoot] = useState<
    string | null
  >(null);
  const [phpIdeReadinessVersion, setPhpIdeReadinessVersion] = useState(0);
  const [
    javaScriptTypeScriptLanguageServerRuntimeStatus,
    setJavaScriptTypeScriptLanguageServerRuntimeStatus,
  ] = useState(null as LanguageServerRuntimeStatus | null);
  const [
    javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
    setJavaScriptTypeScriptLanguageServerRuntimeStatusRoot,
  ] = useState<string | null>(null);
  const setters = {
    setInstallingManagedPhpactor,
    setInstallingManagedTypeScriptLanguageServer,
    setJavaScriptTypeScriptLanguageServerPlan,
    setJavaScriptTypeScriptLanguageServerRuntimeStatus,
    setJavaScriptTypeScriptLanguageServerRuntimeStatusRoot,
    setLanguageServerPlan,
    setLanguageServerRuntimeStatus,
    setLanguageServerRuntimeStatusRoot,
    setLanguageServerSetupOpen,
    setPhpIdeReadinessVersion,
    setPhpTools,
  };
  const commands = runtimeProjectionCommandsFor(setters);

  return {
    commands,
    installingManagedPhpactor,
    installingManagedTypeScriptLanguageServer,
    javaScriptTypeScriptLanguageServerPlan,
    javaScriptTypeScriptLanguageServerRuntimeStatus,
    javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
    languageServerPlan,
    languageServerRuntimeStatus,
    languageServerRuntimeStatusRoot,
    languageServerSetupOpen,
    phpIdeReadinessVersion,
    phpTools,
    setInstallingManagedPhpactor,
    setInstallingManagedTypeScriptLanguageServer,
    setJavaScriptTypeScriptLanguageServerPlan,
    setJavaScriptTypeScriptLanguageServerRuntimeStatus,
    setJavaScriptTypeScriptLanguageServerRuntimeStatusRoot,
    setLanguageServerPlan,
    setLanguageServerRuntimeStatus,
    setLanguageServerRuntimeStatusRoot,
    setLanguageServerSetupOpen,
    setPhpIdeReadinessVersion,
    setPhpTools,
  };
}

function runtimeProjectionCommandsFor({
  setInstallingManagedPhpactor,
  setInstallingManagedTypeScriptLanguageServer,
  setJavaScriptTypeScriptLanguageServerPlan,
  setJavaScriptTypeScriptLanguageServerRuntimeStatus,
  setJavaScriptTypeScriptLanguageServerRuntimeStatusRoot,
  setLanguageServerPlan,
  setLanguageServerRuntimeStatus,
  setLanguageServerRuntimeStatusRoot,
  setLanguageServerSetupOpen,
  setPhpIdeReadinessVersion,
  setPhpTools,
}: WorkbenchLanguageRuntimeProjectionSetters): WorkbenchLanguageRuntimeProjectionCommands {
  const existing = commandsByProjectionOwner.get(setPhpTools);
  if (existing) return existing;
  const commands = Object.freeze({
    bumpPhpIdeReadinessVersion: () => setPhpIdeReadinessVersion((current) => current + 1),
    prepareWorkspace: (status: LanguageServerRuntimeStatus | null, rootPath: string) => {
      setPhpTools(null);
      setLanguageServerPlan(null);
      setJavaScriptTypeScriptLanguageServerPlan(null);
      setLanguageServerRuntimeStatus(status);
      setLanguageServerRuntimeStatusRoot(status ? rootPath : null);
      setJavaScriptTypeScriptLanguageServerRuntimeStatus(null);
      setJavaScriptTypeScriptLanguageServerRuntimeStatusRoot(null);
      setPhpIdeReadinessVersion(0);
    },
    reset: () => {
      setPhpTools(null);
      setLanguageServerPlan(null);
      setJavaScriptTypeScriptLanguageServerPlan(null);
      setLanguageServerRuntimeStatus(null);
      setLanguageServerRuntimeStatusRoot(null);
      setJavaScriptTypeScriptLanguageServerRuntimeStatus(null);
      setJavaScriptTypeScriptLanguageServerRuntimeStatusRoot(null);
      setInstallingManagedTypeScriptLanguageServer(false);
      setLanguageServerSetupOpen(false);
      setInstallingManagedPhpactor(false);
      setPhpIdeReadinessVersion(0);
    },
  });
  commandsByProjectionOwner.set(setPhpTools, commands);
  return commands;
}

export interface WorkbenchLanguageRuntimeProjectionRefBridgeDependencies {
  readonly javaScriptTypeScriptLanguageServerRuntimeStatus: LanguageServerRuntimeStatus | null;
  readonly javaScriptTypeScriptLanguageServerRuntimeStatusRef: {
    current: LanguageServerRuntimeStatus | null;
  };
  readonly javaScriptTypeScriptLanguageServerRuntimeStatusRoot: string | null;
  readonly javaScriptTypeScriptLanguageServerRuntimeStatusRootRef: { current: string | null };
  readonly languageServerRuntimeStatus: LanguageServerRuntimeStatus | null;
  readonly languageServerRuntimeStatusRef: { current: LanguageServerRuntimeStatus | null };
  readonly languageServerRuntimeStatusRoot: string | null;
  readonly languageServerRuntimeStatusRootRef: { current: string | null };
}

export function useWorkbenchLanguageRuntimeProjectionRefBridge({
  javaScriptTypeScriptLanguageServerRuntimeStatus,
  javaScriptTypeScriptLanguageServerRuntimeStatusRef,
  javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
  javaScriptTypeScriptLanguageServerRuntimeStatusRootRef,
  languageServerRuntimeStatus,
  languageServerRuntimeStatusRef,
  languageServerRuntimeStatusRoot,
  languageServerRuntimeStatusRootRef,
}: WorkbenchLanguageRuntimeProjectionRefBridgeDependencies): void {
  useEffect(() => {
    languageServerRuntimeStatusRef.current = languageServerRuntimeStatus;
    languageServerRuntimeStatusRootRef.current = languageServerRuntimeStatusRoot;
  }, [
    languageServerRuntimeStatus,
    languageServerRuntimeStatusRef,
    languageServerRuntimeStatusRoot,
    languageServerRuntimeStatusRootRef,
  ]);

  useEffect(() => {
    javaScriptTypeScriptLanguageServerRuntimeStatusRef.current =
      javaScriptTypeScriptLanguageServerRuntimeStatus;
    javaScriptTypeScriptLanguageServerRuntimeStatusRootRef.current =
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot;
  }, [
    javaScriptTypeScriptLanguageServerRuntimeStatus,
    javaScriptTypeScriptLanguageServerRuntimeStatusRef,
    javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
    javaScriptTypeScriptLanguageServerRuntimeStatusRootRef,
  ]);
}
