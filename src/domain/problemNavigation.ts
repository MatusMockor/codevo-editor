import type {
  WorkbenchNotice,
  WorkbenchNoticeNavigationTarget,
  WorkbenchNoticePosition,
} from "../application/workbenchNotice";
import { isDiagnosticNotice } from "./diagnosticsSummary";

export interface ProblemLocation {
  path: string;
  position: WorkbenchNoticePosition;
}

export function problemLocationsFromNotices(
  notices: WorkbenchNotice[],
): ProblemLocation[] {
  const locations: ProblemLocation[] = [];

  for (const notice of notices) {
    if (!isDiagnosticNotice(notice)) {
      continue;
    }

    const target = notice.navigationTarget;

    if (!target) {
      continue;
    }

    locations.push(problemLocationFromTarget(target));
  }

  return locations.sort(compareProblemLocations);
}

export function nextProblemLocation(
  notices: WorkbenchNotice[],
  current: ProblemLocation | null,
): ProblemLocation | null {
  const locations = problemLocationsFromNotices(notices);

  if (locations.length === 0) {
    return null;
  }

  if (!current) {
    return locations[0];
  }

  const after = locations.find(
    (location) => compareProblemLocations(location, current) > 0,
  );

  return after ?? locations[0];
}

export function previousProblemLocation(
  notices: WorkbenchNotice[],
  current: ProblemLocation | null,
): ProblemLocation | null {
  const locations = problemLocationsFromNotices(notices);

  if (locations.length === 0) {
    return null;
  }

  if (!current) {
    return locations[locations.length - 1];
  }

  const before = [...locations]
    .reverse()
    .find((location) => compareProblemLocations(location, current) < 0);

  return before ?? locations[locations.length - 1];
}

function problemLocationFromTarget(
  target: WorkbenchNoticeNavigationTarget,
): ProblemLocation {
  return {
    path: target.path,
    position: target.range.start,
  };
}

function compareProblemLocations(
  left: ProblemLocation,
  right: ProblemLocation,
): number {
  if (left.path !== right.path) {
    return left.path < right.path ? -1 : 1;
  }

  if (left.position.lineNumber !== right.position.lineNumber) {
    return left.position.lineNumber - right.position.lineNumber;
  }

  return left.position.column - right.position.column;
}
