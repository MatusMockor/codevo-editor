import type { BottomPanelView } from "./bottomPanel";

export interface ArtisanRoute {
  methods?: string[];
  uri?: string;
  name?: string;
  action?: string;
  middleware?: string[];
}

export type ArtisanRoutesResult =
  | { status: "ok"; routes: ArtisanRoute[]; total: number }
  | { status: "unavailable"; message: string }
  | { status: "error"; message: string };

export interface ArtisanRoutesGateway {
  list(rootPath: string): Promise<ArtisanRoutesResult>;
}

export type WorkbenchBottomPanelView = BottomPanelView | "routes";

export interface ArtisanControllerAction {
  className: string;
  methodName: string;
}

export function filterArtisanRoutes(
  routes: readonly ArtisanRoute[],
  query: string,
): ArtisanRoute[] {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return [...routes];
  }

  return routes.filter((route) =>
    [route.uri, route.name, route.action, ...(route.methods ?? [])].some(
      (value) => value?.toLowerCase().includes(normalizedQuery),
    ),
  );
}

export function artisanControllerAction(
  action: string | undefined,
): ArtisanControllerAction | null {
  const normalizedAction = action?.trim().replace(/^\\+/, "") ?? "";

  if (!normalizedAction || normalizedAction.toLowerCase() === "closure") {
    return null;
  }

  const separator = normalizedAction.lastIndexOf("@");

  if (separator < 0) {
    if (!isControllerClassName(normalizedAction)) {
      return null;
    }

    return { className: normalizedAction, methodName: "__invoke" };
  }

  if (separator === 0 || separator === normalizedAction.length - 1) {
    return null;
  }

  const className = normalizedAction.slice(0, separator);
  const methodName = normalizedAction.slice(separator + 1);

  if (!isControllerClassName(className) || !isPhpIdentifier(methodName)) {
    return null;
  }

  return {
    className,
    methodName,
  };
}

function isControllerClassName(value: string): boolean {
  const parts = value.split("\\");

  if (!parts.every(isPhpIdentifier)) {
    return false;
  }

  return parts.length > 1 || parts[0].endsWith("Controller");
}

function isPhpIdentifier(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}
