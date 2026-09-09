import { Suspense, type ComponentProps, type ReactNode } from "react";
import { AgentFrameFallback } from "./AgentFrameFallback";
import { DeferredSurfaceHost } from "./DeferredSurfaceHost";
import { SurfacePlaceholder } from "./SurfacePlaceholder";
import { initializeMonacoRuntime } from "./monacoRuntimeLoader";
import { retryableLazy } from "./retryableLazy";

export function StickyLazySurfaceHost({
  active,
  children,
  fallback = null,
  label,
}: {
  readonly active: boolean;
  readonly children: ReactNode;
  readonly fallback?: ReactNode;
  readonly label: string;
}) {
  const surface = fallback ?? <SurfacePlaceholder label={label} />;
  return (
    <DeferredSurfaceHost active={active} fallback={surface}>
      <Suspense fallback={surface}>{children}</Suspense>
    </DeferredSurfaceHost>
  );
}

export function LazySurfaceHost({
  active,
  children,
  label,
}: {
  readonly active: boolean;
  readonly children: ReactNode;
  readonly label: string;
}) {
  if (!active) return null;
  return <Suspense fallback={<SurfacePlaceholder label={label} />}>{children}</Suspense>;
}

export const LazyScopedEditorSurface = retryableLazy<
  ComponentProps<typeof import("./ScopedEditorSurface").ScopedEditorSurface>
>(async () => {
  await initializeMonacoRuntime();
  const module = await import("./ScopedEditorSurface");
  return { default: module.ScopedEditorSurface };
}, "editor");
export const LazyWorkbenchEditorHost = retryableLazy<
  ComponentProps<typeof import("./WorkbenchEditorHost").WorkbenchEditorHost>
>(async () => {
  await initializeMonacoRuntime();
  const module = await import("./WorkbenchEditorHost");
  return { default: module.WorkbenchEditorHost };
}, "editor runtime");
export const LazyGitDiffPreview = retryableLazy<
  ComponentProps<typeof import("./GitDiffPreview").GitDiffPreview>
>(
  async () => {
    await initializeMonacoRuntime();
    const module = await import("./GitDiffPreview");
    return { default: module.GitDiffPreview };
  },
  "diff viewer",
  "Could not render this diff",
);
export const LazyFileHistoryPanel = retryableLazy<
  ComponentProps<typeof import("./FileHistoryPanel").FileHistoryPanel>
>(async () => {
  await initializeMonacoRuntime();
  const module = await import("./FileHistoryPanel");
  return { default: module.FileHistoryPanel };
}, "file history");
export const LazyLocalHistoryPanel = retryableLazy<
  ComponentProps<typeof import("./LocalHistoryPanel").LocalHistoryPanel>
>(async () => {
  await initializeMonacoRuntime();
  const module = await import("./LocalHistoryPanel");
  return { default: module.LocalHistoryPanel };
}, "local history");
export const LazyExternalFileCompareDialog = retryableLazy<
  ComponentProps<typeof import("./ExternalFileCompareDialog").ExternalFileCompareDialog>
>(async () => {
  await initializeMonacoRuntime();
  const module = await import("./ExternalFileCompareDialog");
  return { default: module.ExternalFileCompareDialog };
}, "file comparison");
export const AGENT_WORKSPACE_LABEL = "agent workspace";
export const LazyAgentWorkbenchScreen = retryableLazy<
  ComponentProps<typeof import("./agentMode/AgentWorkbenchScreen").AgentWorkbenchScreen>
>(
  () =>
    import("./agentMode/AgentWorkbenchScreen").then((module) => ({
      default: module.AgentWorkbenchScreen,
    })),
  AGENT_WORKSPACE_LABEL,
  `Could not load ${AGENT_WORKSPACE_LABEL}`,
  <AgentFrameFallback label={AGENT_WORKSPACE_LABEL} />,
);
export const LazyCommandPalette = retryableLazy<
  ComponentProps<typeof import("./CommandPalette").CommandPalette>
>(
  () => import("./CommandPalette").then((module) => ({ default: module.CommandPalette })),
  "command palette",
);
export const LazyArtisanMakePalette = retryableLazy<
  ComponentProps<typeof import("./ArtisanMakePalette").ArtisanMakePalette>
>(
  () => import("./ArtisanMakePalette").then((module) => ({ default: module.ArtisanMakePalette })),
  "Artisan command palette",
);
export const LazyQuickOpen = retryableLazy<ComponentProps<typeof import("./QuickOpen").QuickOpen>>(
  () => import("./QuickOpen").then((module) => ({ default: module.QuickOpen })),
  "Quick Open",
);
export const LazySearchEverywhere = retryableLazy<
  ComponentProps<typeof import("./SearchEverywhere").SearchEverywhere>
>(
  () => import("./SearchEverywhere").then((module) => ({ default: module.SearchEverywhere })),
  "Search Everywhere",
);
export const LazyWorkbenchSettingsHost = retryableLazy<
  ComponentProps<typeof import("./WorkbenchSettingsHost").WorkbenchSettingsHost>
>(
  () =>
    import("./WorkbenchSettingsHost").then((module) => ({
      default: module.WorkbenchSettingsHost,
    })),
  "settings",
);

export function LazyAgentWorkbenchHost({
  active,
  ...props
}: ComponentProps<typeof LazyAgentWorkbenchScreen> & { readonly active: boolean }) {
  return (
    <StickyLazySurfaceHost
      active={active}
      fallback={<AgentFrameFallback label={AGENT_WORKSPACE_LABEL} />}
      label={AGENT_WORKSPACE_LABEL}
    >
      <LazyAgentWorkbenchScreen {...props} />
    </StickyLazySurfaceHost>
  );
}

export function LazyWorkbenchEditorRuntimeHost({
  active,
  ...props
}: ComponentProps<typeof LazyWorkbenchEditorHost> & { readonly active: boolean }) {
  return (
    <StickyLazySurfaceHost active={active} label="editor runtime">
      <LazyWorkbenchEditorHost {...props} />
    </StickyLazySurfaceHost>
  );
}

export function LazyCommandPaletteHost({
  active,
  ...props
}: ComponentProps<typeof LazyCommandPalette> & { readonly active: boolean }) {
  return (
    <StickyLazySurfaceHost active={active} label="command palette">
      <LazyCommandPalette {...props} />
    </StickyLazySurfaceHost>
  );
}
