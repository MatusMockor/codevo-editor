import { useMemo } from "react";
import type { useWorkbenchController } from "../application/useWorkbenchController";
import {
  ideActivityDetail,
  ideActivityStatus,
  ideActivitySummary,
  phpLanguageServerActivityLabel,
  type IdeActivitySummary,
} from "../domain/ideActivity";
import { languageServerStatusLabel } from "../domain/languageServerRuntime";
import { workspaceInfoLabel } from "./appPresentation";

type Workbench = ReturnType<typeof useWorkbenchController>;

export type EditorStatusWorkbench = Pick<
  Workbench,
  | "activeFrameworkActivityLabel"
  | "indexProgress"
  | "intelligenceMode"
  | "javaScriptTypeScriptLanguageServerRuntimeStatus"
  | "languageServerPlan"
  | "languageServerRuntimeStatus"
  | "phpTools"
  | "workspaceDescriptor"
  | "workspaceRoot"
  | "workspaceSettings"
>;

export interface EditorStatusPresentation {
  readonly workspaceLabel: string | null;
  readonly ideActivityLabel: string | null;
  readonly ideActivitySummary: IdeActivitySummary | null;
  readonly ideActivityDetail: string;
}

export function useEditorStatusPresentation(
  workbench: EditorStatusWorkbench,
  activeLanguage: string | null,
): EditorStatusPresentation {
  const {
    activeFrameworkActivityLabel,
    indexProgress,
    intelligenceMode,
    javaScriptTypeScriptLanguageServerRuntimeStatus: typeScriptRuntimeStatus,
    languageServerPlan,
    languageServerRuntimeStatus: phpRuntimeStatus,
    phpTools,
    workspaceDescriptor,
    workspaceRoot,
    workspaceSettings,
  } = workbench;
  const { javaScriptTypeScriptVersion, phpVersionOverride } = workspaceSettings;
  const workspaceLabel = useMemo(
    () =>
      workspaceInfoLabel({
        activeLanguage,
        javaScriptTypeScriptVersion,
        phpTools,
        phpVersionOverride,
        workspaceDescriptor,
      }),
    [
      activeLanguage,
      javaScriptTypeScriptVersion,
      phpTools,
      phpVersionOverride,
      workspaceDescriptor,
    ],
  );
  const languageServerLabel = useMemo(
    () =>
      [
        phpLanguageServerActivityLabel(
          intelligenceMode,
          phpRuntimeStatus,
          workspaceRoot,
          languageServerPlan,
        ),
        languageServerStatusLabel(typeScriptRuntimeStatus, "TS Server", { workspaceRoot }),
      ]
        .filter(Boolean)
        .join(" · ") || null,
    [
      intelligenceMode,
      languageServerPlan,
      phpRuntimeStatus,
      typeScriptRuntimeStatus,
      workspaceRoot,
    ],
  );
  const activity = useMemo(
    () => ideActivityStatus(indexProgress, languageServerLabel, activeFrameworkActivityLabel),
    [activeFrameworkActivityLabel, indexProgress, languageServerLabel],
  );
  const summary = useMemo(
    () =>
      ideActivitySummary(workspaceRoot, phpRuntimeStatus, typeScriptRuntimeStatus, indexProgress),
    [indexProgress, phpRuntimeStatus, typeScriptRuntimeStatus, workspaceRoot],
  );
  const detail = useMemo(
    () =>
      ideActivityDetail(workspaceRoot, phpRuntimeStatus, typeScriptRuntimeStatus, indexProgress),
    [indexProgress, phpRuntimeStatus, typeScriptRuntimeStatus, workspaceRoot],
  );
  return useMemo(
    () => ({
      workspaceLabel,
      ideActivityLabel: activity.label,
      ideActivitySummary: summary,
      ideActivityDetail: detail,
    }),
    [activity, detail, summary, workspaceLabel],
  );
}
