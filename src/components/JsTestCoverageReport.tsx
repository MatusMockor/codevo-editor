import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { JsTestCoverageReport, JsTestFileCoverage } from "../domain/jsTestCoverage";
import { boundedListNavigationIndex } from "./jsTestExplorerPanelProjection";
import { useWindowedRows } from "./useWindowedRows";

const COVERAGE_ROW_HEIGHT = 46;
const WINDOWING_THRESHOLD = 80;

const styles: Record<string, CSSProperties> = {
  coverage: { borderBottom: "1px solid var(--border-subtle)", padding: "7px 8px" },
  coverageFile: {
    alignItems: "center",
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    minHeight: COVERAGE_ROW_HEIGHT,
    padding: "3px 0",
  },
  coverageFiles: { listStyle: "none", margin: 0, padding: 0, position: "relative" },
  coverageSummary: { display: "flex", flexWrap: "wrap", gap: 10 },
  label: {
    background: "transparent",
    border: 0,
    color: "inherit",
    font: "inherit",
    minWidth: 0,
    overflow: "hidden",
    padding: 0,
    textAlign: "left",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  viewport: { marginTop: 5, maxHeight: 276, overflow: "auto" },
};

export function JsTestCoverageReportView({
  onOpenFile,
  report,
}: {
  readonly onOpenFile: (file: JsTestFileCoverage) => void;
  readonly report: JsTestCoverageReport;
}): ReactNode {
  return (
    <section aria-label="JavaScript test coverage summary" style={styles.coverage}>
      <div style={styles.coverageSummary}>
        <strong>Coverage</strong>
        <span aria-label="Covered lines">
          {report.summary.covered}/{report.summary.total} lines
        </span>
        <span aria-label="Line coverage percentage">
          {coveragePercentage(report.summary.percentage)}
        </span>
        <span aria-label="Covered branches">
          {report.branches.covered}/{report.branches.total} branches
        </span>
        <span aria-label="Branch coverage percentage">
          {coveragePercentage(report.branches.percentage)}
        </span>
        <span aria-label="Covered functions">
          {report.functions.covered}/{report.functions.total} functions
        </span>
        <span aria-label="Function coverage percentage">
          {coveragePercentage(report.functions.percentage)}
        </span>
      </div>
      {report.truncated ? (
        <span aria-label="Coverage truncation status" role="status">
          Coverage details are truncated.
        </span>
      ) : null}
      {report.files.length > 0 ? (
        <WindowedCoverageFiles files={report.files} onOpenFile={onOpenFile} />
      ) : null}
    </section>
  );
}

function WindowedCoverageFiles({
  files,
  onOpenFile,
}: {
  readonly files: readonly JsTestFileCoverage[];
  readonly onOpenFile: (file: JsTestFileCoverage) => void;
}): ReactNode {
  const [activeIndex, setActiveIndex] = useState(0);
  const rowRefs = useRef<Map<number, HTMLLIElement>>(new Map());
  const estimateHeight = useCallback(() => COVERAGE_ROW_HEIGHT, []);
  const keyForIndex = useCallback(
    (index: number) => files[index]?.path ?? `missing-${index}`,
    [files],
  );
  const windowed = useWindowedRows({
    enabled: files.length > WINDOWING_THRESHOLD,
    estimateHeight,
    itemCount: files.length,
    keyForIndex,
    overscan: 8,
    pinnedIndices: [activeIndex],
  });

  useEffect(() => {
    if (activeIndex < files.length) return;
    setActiveIndex(Math.max(0, files.length - 1));
  }, [activeIndex, files.length]);

  const moveFocus = (nextIndex: number): void => {
    if (nextIndex < 0) return;
    setActiveIndex(nextIndex);
    windowed.scrollToIndex(nextIndex, "nearest");
    requestAnimationFrame(() => rowRefs.current.get(nextIndex)?.focus());
  };
  const onKeyDown = (
    event: KeyboardEvent<HTMLLIElement>,
    index: number,
    file: JsTestFileCoverage,
  ): void => {
    if (event.target !== event.currentTarget) return;
    if ((event.key === "Enter" || event.key === " ") && file.firstUncoveredLine !== null) {
      event.preventDefault();
      onOpenFile(file);
      return;
    }
    if (
      event.key !== "ArrowDown" &&
      event.key !== "ArrowUp" &&
      event.key !== "Home" &&
      event.key !== "End"
    ) {
      return;
    }
    event.preventDefault();
    moveFocus(boundedListNavigationIndex(index, files.length, event.key));
  };
  const isWindowed = files.length > WINDOWING_THRESHOLD;

  return (
    <div onScroll={windowed.onScroll} ref={windowed.containerRef} style={styles.viewport}>
      <ul
        aria-label="JavaScript coverage files"
        style={{
          ...styles.coverageFiles,
          height: isWindowed ? windowed.totalHeight : undefined,
        }}
      >
        {windowed.rows.map(({ index, offsetTop }) => {
          const file = files[index];
          if (!file) return null;
          return (
            <li
              aria-disabled={file.firstUncoveredLine === null}
              aria-label={`Coverage file ${file.path}`}
              aria-posinset={index + 1}
              aria-setsize={files.length}
              key={file.path}
              onFocus={() => setActiveIndex(index)}
              onKeyDown={(event) => onKeyDown(event, index, file)}
              ref={(element) => {
                if (element) rowRefs.current.set(index, element);
                else rowRefs.current.delete(index);
                windowed.measureRow(file.path, element);
              }}
              style={{
                ...styles.coverageFile,
                ...(isWindowed ? { left: 0, position: "absolute", right: 0, top: offsetTop } : {}),
              }}
              tabIndex={index === activeIndex ? 0 : -1}
            >
              <button
                aria-label={`Open first uncovered line in ${file.path}`}
                disabled={file.firstUncoveredLine === null}
                onClick={() => onOpenFile(file)}
                style={{
                  ...styles.label,
                  cursor: file.firstUncoveredLine === null ? "default" : "pointer",
                }}
                tabIndex={-1}
                type="button"
              >
                {file.path}
              </button>
              <span>
                Lines {file.summary.covered}/{file.summary.total} ·{" "}
                {coveragePercentage(file.summary.percentage)} · Branches {file.branches.covered}/
                {file.branches.total} · {coveragePercentage(file.branches.percentage)} · Functions{" "}
                {file.functions.covered}/{file.functions.total} ·{" "}
                {coveragePercentage(file.functions.percentage)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function coveragePercentage(percentage: number | null): string {
  return percentage === null ? "—" : `${percentage.toFixed(1)}%`;
}
