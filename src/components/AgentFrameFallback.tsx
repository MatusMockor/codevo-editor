export function AgentFrameFallback({ label }: { readonly label: string }) {
  return (
    <div className="agent-frame-fallback" data-slot="agent" role="status">
      <span className="surface-placeholder__label">Loading {label}…</span>
      <div className="agent-frame-fallback__rail" />
      <div className="agent-frame-fallback__center" />
    </div>
  );
}
