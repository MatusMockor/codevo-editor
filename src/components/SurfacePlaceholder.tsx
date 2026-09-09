export function SurfacePlaceholder({ label }: { readonly label: string }) {
  return (
    <div className="surface-placeholder" data-surface-placeholder role="status">
      <span className="surface-placeholder__label">Loading {label}…</span>
    </div>
  );
}
