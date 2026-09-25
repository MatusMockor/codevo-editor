import { ChevronRight } from "lucide-react";
import { Fragment, useMemo } from "react";
import { editorBreadcrumbSegments } from "../../domain/editorBreadcrumbSegments";
import { cx } from "../../ui/foundation/classNames";

export interface EditorPathCrumbsProps {
  readonly rootPath: string | null;
  readonly documentPath: string;
  onReveal(): void;
}

export function EditorPathCrumbs({ documentPath, onReveal, rootPath }: EditorPathCrumbsProps) {
  const segments = useMemo(
    () => editorBreadcrumbSegments(rootPath, documentPath),
    [documentPath, rootPath],
  );
  return (
    <>
      {segments.map((segment, index) => (
        <Fragment key={`${segment.kind}:${segment.path}`}>
          {index === 0 ? null : (
            <ChevronRight aria-hidden="true" className="cv-esub__sep" size={12} />
          )}
          <button
            aria-current={segment.kind === "file" ? "location" : undefined}
            className={cx("cv-esub__crumb", segment.kind === "file" && "cv-esub__crumb--current")}
            onClick={onReveal}
            title={segment.path}
            type="button"
          >
            {segment.label}
          </button>
        </Fragment>
      ))}
    </>
  );
}
