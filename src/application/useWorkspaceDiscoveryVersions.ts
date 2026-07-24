import { useCallback, useState } from "react";
import { workspaceFileChangeInvalidatesExpressRouteDiscovery } from "../domain/expressRouteDiscoveryInvalidation";
import { workspaceFileChangeTriggersJsTestContinuousRun } from "../domain/jsTestContinuousRunInvalidation";
import { workspaceFileChangeInvalidatesJsTestCoverage } from "../domain/jsTestCoverageInvalidation";
import { workspaceFileChangeInvalidatesJsTestDiscovery } from "../domain/jsTestDiscoveryInvalidation";
import { workspaceFileChangeInvalidatesNetteServicesDiscovery } from "../domain/netteWorkspaceDiscoveryInvalidation";
import { workspaceFileChangeInvalidatesNodePackageScriptDiscovery } from "../domain/nodePackageScriptDiscoveryInvalidation";
import { isNetteApplicationProject } from "../domain/netteOperationalProject";
import { workspaceFileChangeInvalidatesSymfonyDiscovery } from "../domain/symfonyWorkspaceDiscoveryInvalidation";
import type { PhpProjectDescriptor } from "../domain/workspace";
import type { WorkspaceFileChangeEvent } from "../domain/workspaceFileChange";
import { createPhpTestCoverageInvalidationStore } from "./phpTestCoverageInvalidationStore";

interface WorkspaceDiscoveryVersionsOptions {
  readonly phpProject?: PhpProjectDescriptor | null;
  readonly symfonyEnabled?: boolean;
}

const VSCODE_TASKS_DIRECTORY = ".vscode";
const VSCODE_TASKS_FILE = ".vscode/tasks.json";
const NODE_LAUNCH_CONFIGURATION_DIRECTORIES: readonly string[] = [".codevo", ".vscode"];
const NODE_LAUNCH_CONFIGURATION_FILES: readonly string[] = [
  ".codevo/launch.json",
  ".vscode/launch.json",
];

export function useWorkspaceDiscoveryVersions({
  phpProject = null,
  symfonyEnabled = false,
}: WorkspaceDiscoveryVersionsOptions = {}) {
  const [expressRouteDiscoveryVersion, setExpressRouteDiscoveryVersion] = useState(0);
  const [jsTestContinuousRunVersion, setJsTestContinuousRunVersion] = useState(0);
  const [jsTestCoverageVersion, setJsTestCoverageVersion] = useState(0);
  const [jsTestDiscoveryVersion, setJsTestDiscoveryVersion] = useState(0);
  const [netteDiscoveryVersion, setNetteDiscoveryVersion] = useState(0);
  const [nodeLaunchConfigurationVersion, setNodeLaunchConfigurationVersion] = useState(0);
  const [nodePackageScriptDiscoveryVersion, setNodePackageScriptDiscoveryVersion] = useState(0);
  const [phpTestCoverageInvalidationStore] = useState(createPhpTestCoverageInvalidationStore);
  const [symfonyDiscoveryVersion, setSymfonyDiscoveryVersion] = useState(0);
  const [vscodeProcessTasksVersion, setVscodeProcessTasksVersion] = useState(0);
  const netteServicesEnabled = phpProject ? isNetteApplicationProject(phpProject) : false;
  const invalidateJsTestCoverageAndResults = useCallback(() => {
    setJsTestCoverageVersion((version) => version + 1);
  }, []);

  const handleWorkspaceDiscoveryFileChange = useCallback(
    (event: WorkspaceFileChangeEvent) => {
      if (workspaceFileChangeInvalidatesExpressRouteDiscovery(event)) {
        setExpressRouteDiscoveryVersion((version) => version + 1);
      }
      if (workspaceFileChangeInvalidatesJsTestDiscovery(event)) {
        setJsTestDiscoveryVersion((version) => version + 1);
      }
      if (workspaceFileChangeTriggersJsTestContinuousRun(event)) {
        setJsTestContinuousRunVersion((version) => version + 1);
      }
      if (workspaceFileChangeInvalidatesJsTestCoverage(event)) {
        setJsTestCoverageVersion((version) => version + 1);
      }
      if (workspaceFileChangeInvalidatesNodePackageScriptDiscovery(event)) {
        setNodePackageScriptDiscoveryVersion((version) => version + 1);
      }
      if (workspaceFileChangeInvalidatesNodeLaunchConfigurations(event)) {
        setNodeLaunchConfigurationVersion((version) => version + 1);
      }
      if (workspaceFileChangeInvalidatesVscodeProcessTasks(event)) {
        setVscodeProcessTasksVersion((version) => version + 1);
      }
      phpTestCoverageInvalidationStore.handleWorkspaceFileChange(event);
      if (netteServicesEnabled && workspaceFileChangeInvalidatesNetteServicesDiscovery(event)) {
        setNetteDiscoveryVersion((version) => version + 1);
      }
      if (symfonyEnabled && workspaceFileChangeInvalidatesSymfonyDiscovery(event)) {
        setSymfonyDiscoveryVersion((version) => version + 1);
      }
    },
    [netteServicesEnabled, phpTestCoverageInvalidationStore, symfonyEnabled],
  );

  return {
    expressRouteDiscoveryVersion,
    handleWorkspaceDiscoveryFileChange,
    invalidateJsTestCoverageAndResults,
    jsTestContinuousRunVersion,
    jsTestCoverageVersion,
    jsTestDiscoveryVersion,
    netteDiscoveryVersion,
    nodeLaunchConfigurationVersion,
    nodePackageScriptDiscoveryVersion,
    phpTestCoverageInvalidationStore,
    symfonyDiscoveryVersion,
    vscodeProcessTasksVersion,
  };
}

function workspaceFileChangeInvalidatesNodeLaunchConfigurations(
  event: WorkspaceFileChangeEvent,
): boolean {
  if (event.kind === "rescanRequired") return true;
  const paths = watcherRelativePaths(event);

  if (event.fileKind === "directory") {
    return (
      (event.kind === "created" || event.kind === "deleted" || event.kind === "renamed") &&
      paths.some((path) => NODE_LAUNCH_CONFIGURATION_DIRECTORIES.includes(path))
    );
  }
  return paths.some((path) => NODE_LAUNCH_CONFIGURATION_FILES.includes(path));
}

function workspaceFileChangeInvalidatesVscodeProcessTasks(
  event: WorkspaceFileChangeEvent,
): boolean {
  if (event.kind === "rescanRequired") return true;
  const paths = watcherRelativePaths(event);

  if (event.fileKind === "directory") {
    return (
      (event.kind === "created" || event.kind === "deleted" || event.kind === "renamed") &&
      paths.includes(VSCODE_TASKS_DIRECTORY)
    );
  }
  return paths.includes(VSCODE_TASKS_FILE);
}

function watcherRelativePaths(event: WorkspaceFileChangeEvent): string[] {
  return [event.relativePath, event.previousRelativePath]
    .filter((path): path is string => path !== null && path !== undefined)
    .map(normalizeWatcherRelativePath);
}

function normalizeWatcherRelativePath(path: string): string {
  return path
    .trim()
    .split("\\")
    .join("/")
    .replace(/^\.\/+/, "")
    .replace(/\/+/g, "/")
    .replace(/\/+$/, "");
}
