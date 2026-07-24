import type { NetteWorkspaceRouteTarget } from "../domain/netteWorkspaceRoutes";
import type {
  NetteWorkspacePresenterSource,
  NetteWorkspacePresentersResult,
} from "../domain/netteWorkspacePresenters";

export function netteRouteTargetNavigationSource(
  target: NetteWorkspaceRouteTarget,
  presenters: NetteWorkspacePresentersResult,
): NetteWorkspacePresenterSource | null {
  if (presenters.status !== "ok" || presenters.truncated) return null;
  const targetParts = target.presenter.split(":");
  const shortName = targetParts[targetParts.length - 1];
  if (!shortName) return null;
  const candidates = presenters.presenters.filter((presenter) => {
    if (presenter.name !== shortName) return false;
    return (
      targetParts.length === 1 ||
      conventionalPresenterName(presenter.className) === target.presenter
    );
  });
  if (candidates.length !== 1) return null;
  const presenter = candidates[0]!;
  if (!target.action) return presenter.source;
  const action = presenter.actions.find((candidate) => candidate.name === target.action);
  return action?.actionMethod?.source ?? action?.renderMethod?.source ?? presenter.source;
}

function conventionalPresenterName(className: string | null): string | null {
  if (!className) return null;
  const segments = className.replace(/^\\+/, "").split("\\");
  const classSegment = segments.pop();
  if (!classSegment?.endsWith("Presenter")) return null;
  const presenter = classSegment.slice(0, -"Presenter".length);
  if (!presenter) return null;
  const ignored = new Set(["App", "Application", "Modules", "Presentation", "Presenters", "UI"]);
  const modules = segments
    .filter((segment) => !ignored.has(segment))
    .map((segment) => segment.replace(/Module$/, ""))
    .filter(Boolean);
  if (modules[modules.length - 1] === presenter) modules.pop();
  return [...modules, presenter].join(":");
}
