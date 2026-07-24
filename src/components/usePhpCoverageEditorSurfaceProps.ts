import { useCallback, useRef } from "react";
import type { PhpCloverCoverageReport } from "../domain/phpCloverCoverage";
import { projectPhpCoverageForActiveFile } from "../domain/phpCoverageProjection";
import { isDirty, type EditorDocument } from "../domain/workspace";
import type { EditorSurfaceCoverageProps } from "./useEditorSurfaceCoverageDecorations";

interface PhpCoverageEditorSurfaceOptions {
  readonly report: PhpCloverCoverageReport | null;
  readonly rootPath: string | null;
  readonly workspaceId: string | null;
}

type PhpCoverageEditorSurfaceProps = (
  document: EditorDocument | null,
  active: boolean,
) => EditorSurfaceCoverageProps;

/**
 * Owns the report-identity revision and adapts application coverage state to
 * the narrow, precomputed publication accepted by an editor surface.
 */
export function usePhpCoverageEditorSurfaceProps({
  report,
  rootPath,
  workspaceId,
}: PhpCoverageEditorSurfaceOptions): PhpCoverageEditorSurfaceProps {
  const reportRevision = useReportIdentityRevision(report);

  return useCallback(
    (document, active) => {
      const projection = active
        ? projectPhpCoverageForActiveFile({
            activeFileDirty: document ? isDirty(document) : false,
            activeFilePath: document?.path ?? null,
            report,
            workspaceRoot: rootPath,
          })
        : null;
      if (!projection || !workspaceId) {
        return { phpCoverageActiveOwner: null, phpCoveragePublication: null };
      }
      const owner = Object.freeze({
        ownerKey: JSON.stringify([workspaceId, projection.identity.rootPath]),
        revision: reportRevision,
      });
      return {
        phpCoverageActiveOwner: owner,
        phpCoveragePublication: Object.freeze({
          ...owner,
          documentPath: projection.identity.activeFilePath,
          lines: projection.lines,
        }),
      };
    },
    [report, reportRevision, rootPath, workspaceId],
  );
}

function useReportIdentityRevision(report: PhpCloverCoverageReport | null): number {
  const state = useRef<{
    readonly report: PhpCloverCoverageReport | null;
    readonly revision: number;
  }>({ report: null, revision: 0 });
  if (state.current.report !== report) {
    state.current = { report, revision: state.current.revision + 1 };
  }
  return state.current.revision;
}
