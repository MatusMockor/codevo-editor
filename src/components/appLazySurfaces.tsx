import { Suspense, type ComponentProps, type ReactNode } from "react";
import { DeferredSurfaceHost } from "./DeferredSurfaceHost";
import { initializeMonacoRuntime } from "./monacoRuntimeLoader";
import { retryableLazy } from "./retryableLazy";

export function StickyLazySurfaceHost({
  active,
  children,
  label,
}: {
  readonly active: boolean;
  readonly children: ReactNode;
  readonly label: string;
}) {
  const fallback = <div role="status">Loading {label}…</div>;
  return (
    <DeferredSurfaceHost active={active} fallback={fallback}>
      <Suspense fallback={fallback}>{children}</Suspense>
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
  return <Suspense fallback={<div role="status">Loading {label}…</div>}>{children}</Suspense>;
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
export const LazyAgentWorkbenchScreen = retryableLazy<
  ComponentProps<typeof import("./agentMode/AgentWorkbenchScreen").AgentWorkbenchScreen>
>(
  () =>
    import("./agentMode/AgentWorkbenchScreen").then((module) => ({
      default: module.AgentWorkbenchScreen,
    })),
  "agent workspace",
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
export const LazyWorkbenchSettingsDialogHost = retryableLazy<
  ComponentProps<typeof import("./WorkbenchSettingsDialogHost").WorkbenchSettingsDialogHost>
>(
  () =>
    import("./WorkbenchSettingsDialogHost").then((module) => ({
      default: module.WorkbenchSettingsDialogHost,
    })),
  "settings",
);

export function LazyAgentWorkbenchHost({
  active,
  ...props
}: ComponentProps<typeof LazyAgentWorkbenchScreen> & { readonly active: boolean }) {
  return (
    <StickyLazySurfaceHost active={active} label="agent workspace">
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
