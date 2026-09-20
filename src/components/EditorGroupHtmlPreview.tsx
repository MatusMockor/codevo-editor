import { useMemo, type ReactNode } from "react";
import type { HtmlFilePreviewGateway } from "../application/htmlFilePreviewGateway";
import type { WorkspaceIdentityDescriptor } from "../application/workspaceIdentityGatewayPort";
import { createWorkspaceRootFromPath, parseWorkspacePath } from "../domain/workspacePath";
import { useEditorRuntimeContext } from "./editorRuntimeContext";
import { HtmlEditorPreview } from "./HtmlEditorPreview";

export interface EditorHtmlPreviewEnvironment {
  readonly gateway: HtmlFilePreviewGateway;
  readonly workspace: WorkspaceIdentityDescriptor;
}

export function EditorGroupHtmlPreview({
  children,
  environment,
  groupId,
  name,
  path,
}: {
  readonly children: ReactNode;
  readonly environment: EditorHtmlPreviewEnvironment;
  readonly groupId: string;
  readonly name: string;
  readonly path: string;
}) {
  const runtime = useEditorRuntimeContext();
  const preview = useMemo(
    () => ({
      async prepare(requestedPath: string) {
        const { gateway, workspace } = environment;
        const root = createWorkspaceRootFromPath(workspace.canonicalRoot, workspace.policy);
        const relative = root.ok ? parseWorkspacePath(root.value, requestedPath) : null;
        const capture = runtime?.captureGroupPreviewContent?.(groupId, requestedPath);
        if (
          requestedPath !== path ||
          !relative?.ok ||
          !capture ||
          capture.workspaceId !== workspace.workspaceId ||
          !capture.isCurrent()
        ) {
          throw new Error("The current HTML document is not available for preview.");
        }
        const handle = await gateway.prepare({
          workspaceId: workspace.workspaceId,
          relativePath: relative.value.relativePath,
          html: capture.html,
        });
        if (!capture.isCurrent()) {
          await handle.dispose();
          throw new Error("The HTML document changed while preparing its preview.");
        }
        return handle;
      },
    }),
    [environment, groupId, path, runtime],
  );
  return (
    <HtmlEditorPreview name={name} path={path} preview={preview}>
      {children}
    </HtmlEditorPreview>
  );
}
