// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { mountUi, type MountedUi } from "../ui/foundation/foundationTestSupport";
import {
  ideActivityDetail,
  ideActivityStatus,
  phpLanguageServerActivityLabel,
} from "../domain/ideActivity";
import { initialIndexProgress } from "../domain/indexProgress";
import { languageServerStatusLabel } from "../domain/languageServerRuntime";
import { defaultWorkspaceSettings } from "../domain/settings";
import { workspaceInfoLabel } from "./appPresentation";
import {
  useEditorStatusPresentation,
  type EditorStatusPresentation,
  type EditorStatusWorkbench,
} from "./useEditorStatusPresentation";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const ROOT = "/workspace/app";
const results: EditorStatusPresentation[] = [];

function Probe({ workbench }: { readonly workbench: EditorStatusWorkbench }) {
  results.push(useEditorStatusPresentation(workbench, "typescript"));
  return null;
}

function fixture(): EditorStatusWorkbench {
  return {
    activeFrameworkActivityLabel: null,
    indexProgress: initialIndexProgress(),
    intelligenceMode: "basic",
    javaScriptTypeScriptLanguageServerRuntimeStatus: null,
    languageServerPlan: null,
    languageServerRuntimeStatus: null,
    phpTools: null,
    workspaceDescriptor: null,
    workspaceRoot: ROOT,
    workspaceSettings: defaultWorkspaceSettings(),
  };
}

let mounted: MountedUi | null = null;

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  results.length = 0;
});

describe("useEditorStatusPresentation", () => {
  it("composes the same labels the status bar showed", () => {
    const workbench = fixture();
    mounted = mountUi();
    mounted.render(<Probe workbench={workbench} />);

    const combined =
      [
        phpLanguageServerActivityLabel("basic", null, ROOT, null),
        languageServerStatusLabel(null, "TS Server", { workspaceRoot: ROOT }),
      ]
        .filter(Boolean)
        .join(" · ") || null;
    const activity = ideActivityStatus(ROOT, null, null, workbench.indexProgress, combined, null);
    const latest = results[results.length - 1];

    expect(latest?.ideActivityLabel).toBe(activity.label);
    expect(latest?.ideActivityState).toBe(activity.state);
    expect(latest?.ideActivityDetail).toBe(
      ideActivityDetail(ROOT, null, null, workbench.indexProgress),
    );
    expect(latest?.workspaceLabel).toBe(
      workspaceInfoLabel({
        activeLanguage: "typescript",
        javaScriptTypeScriptVersion: workbench.workspaceSettings.javaScriptTypeScriptVersion,
        phpTools: null,
        phpVersionOverride: workbench.workspaceSettings.phpVersionOverride,
        workspaceDescriptor: null,
      }),
    );
  });

  it("keeps a stable result while its inputs do not change", () => {
    const workbench = fixture();
    mounted = mountUi();
    mounted.render(<Probe workbench={workbench} />);
    mounted.render(<Probe workbench={{ ...workbench }} />);

    expect(results).toHaveLength(2);
    expect(results[1]).toBe(results[0]);
  });
});
