import type { Dispatch, SetStateAction } from "react";
import type { NodePackageTaskProblemsGateway } from "../domain/nodePackageTaskProblems";
import type { NodePackageTaskState } from "./nodePackageTaskLifecycle";
import { useNodePackageTaskProblemNoticeComposition } from "./useNodePackageTaskProblemNoticeComposition";
import { useNodePackageTaskProblems } from "./useNodePackageTaskProblems";
import type { WorkbenchNotice } from "./workbenchNotice";

interface WorkbenchNodePackageTaskProblemsOptions {
  readonly enabled: boolean;
  readonly gateway: NodePackageTaskProblemsGateway;
  readonly rootPath: string | null;
  readonly setNotices: Dispatch<SetStateAction<WorkbenchNotice[]>>;
  readonly task: NodePackageTaskState | null;
  readonly workspaceId: string | null;
}

export function useWorkbenchNodePackageTaskProblems({
  enabled,
  gateway,
  rootPath,
  setNotices,
  task,
  workspaceId,
}: WorkbenchNodePackageTaskProblemsOptions) {
  const problems = useNodePackageTaskProblems({
    enabled,
    gateway,
    rootPath,
    task,
    workspaceId,
  });
  useNodePackageTaskProblemNoticeComposition(problems.notices, setNotices);
  return problems;
}
