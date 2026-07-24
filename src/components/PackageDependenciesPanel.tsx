import { Boxes, Search } from "lucide-react";
import { useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  packageDependencyCount,
  type PackageDependencyTreeItem,
} from "../domain/packageDependencyTree";
import type { PackageDependenciesPanelModel } from "../application/packageDependenciesPanelModel";

export type PackageDependenciesPanelProps = PackageDependenciesPanelModel;

const styles: Record<string, CSSProperties> = {
  badge: {
    border: "1px solid var(--border-subtle)",
    borderRadius: 8,
    color: "var(--text-muted)",
    fontSize: 11,
    padding: "1px 6px",
  },
  action: {
    background: "transparent",
    border: "1px solid var(--border-subtle)",
    borderRadius: 4,
    color: "inherit",
    cursor: "pointer",
    padding: "3px 7px",
  },
  actions: { display: "flex", gap: 4, paddingRight: 8 },
  cell: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  group: { color: "var(--text-muted)", fontWeight: 600, padding: "8px 8px 4px" },
  header: {
    alignItems: "center",
    borderBottom: "1px solid var(--border-subtle)",
    display: "flex",
    gap: 8,
    padding: "6px 8px",
  },
  operationBar: {
    alignItems: "center",
    borderBottom: "1px solid var(--border-subtle)",
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    padding: "6px 8px",
  },
  operationInput: {
    background: "var(--input-background, transparent)",
    border: "1px solid var(--border-subtle)",
    borderRadius: 4,
    color: "inherit",
    minWidth: 180,
    padding: "4px 6px",
  },
  preview: {
    background: "var(--editor-background)",
    borderBottom: "1px solid var(--border-subtle)",
    padding: 10,
  },
  columns: {
    color: "var(--text-muted)",
    display: "grid",
    fontSize: 11,
    gap: 12,
    gridTemplateColumns: "minmax(160px, 1fr) minmax(90px, .55fr) minmax(90px, .55fr) 70px",
    padding: "5px 8px 5px 24px",
  },
  input: { background: "transparent", border: 0, color: "inherit", flex: 1, minWidth: 100 },
  item: {
    alignItems: "center",
    background: "transparent",
    border: 0,
    color: "inherit",
    cursor: "pointer",
    display: "grid",
    font: "inherit",
    gap: 12,
    gridTemplateColumns: "minmax(160px, 1fr) minmax(90px, .55fr) minmax(90px, .55fr) 70px",
    padding: "6px 8px 6px 24px",
    textAlign: "left",
    width: "100%",
  },
  itemRow: { alignItems: "center", display: "flex" },
  list: { listStyle: "none", margin: 0, padding: 0 },
  message: { color: "var(--text-muted)", padding: 16 },
  panel: { height: "100%", overflow: "auto" },
  selected: { background: "var(--selection-background)" },
  statusInstalled: { color: "var(--success, #3fb950)" },
  statusMissing: { color: "var(--warning, #d29922)" },
};

export function PackageDependenciesPanel(props: PackageDependenciesPanelProps): ReactNode {
  const listboxId = useId();
  const items = useMemo(() => props.tree.flatMap((group) => group.items), [props.tree]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [installDevelopment, setInstallDevelopment] = useState(false);
  const [installName, setInstallName] = useState("");
  const openingIdRef = useRef<string | null>(null);
  const selectedIndex = Math.min(activeIndex, Math.max(items.length - 1, 0));
  const selected = items[selectedIndex];
  const disabled = props.busy || openingId !== null;

  const open = (dependency: PackageDependencyTreeItem) => {
    if (openingIdRef.current) return;
    openingIdRef.current = dependency.id;
    setOpeningId(dependency.id);
    void Promise.resolve()
      .then(() => props.onOpenDependency(dependency))
      .finally(() => {
        openingIdRef.current = null;
        setOpeningId(null);
      })
      .catch(() => undefined);
  };

  let itemIndex = -1;
  return (
    <section
      aria-busy={disabled}
      aria-label="Workspace dependencies"
      role="tabpanel"
      style={styles.panel}
    >
      <div style={styles.header}>
        <Boxes aria-hidden="true" size={14} />
        <Search aria-hidden="true" size={14} />
        <input
          aria-activedescendant={
            selected ? packageDependencyOptionId(listboxId, selected.id) : undefined
          }
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded="true"
          aria-label="Filter workspace dependencies"
          disabled={disabled}
          onChange={(event) => {
            setActiveIndex(0);
            props.onQueryChange(event.currentTarget.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActiveIndex((current) => Math.min(current + 1, Math.max(items.length - 1, 0)));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((current) => Math.max(current - 1, 0));
            } else if (event.key === "Home") {
              event.preventDefault();
              setActiveIndex(0);
            } else if (event.key === "End") {
              event.preventDefault();
              setActiveIndex(Math.max(items.length - 1, 0));
            } else if (event.key === "Enter" && selected) {
              event.preventDefault();
              open(selected);
            }
          }}
          placeholder="Filter name, range, version, or status"
          role="combobox"
          style={styles.input}
          value={props.query}
        />
        <span style={styles.badge}>{props.manager ?? "unknown manager"}</span>
        <span aria-label="Dependency total">{packageDependencyCount(props.tree)} packages</span>
      </div>

      <div aria-label="Package operations" style={styles.operationBar}>
        <input
          aria-label="Package name to install"
          autoCapitalize="none"
          autoCorrect="off"
          disabled={disabled}
          maxLength={214}
          onChange={(event) => setInstallName(event.currentTarget.value)}
          placeholder="package or @scope/package"
          spellCheck={false}
          style={styles.operationInput}
          value={installName}
        />
        <select
          aria-label="Dependency type"
          disabled={disabled}
          onChange={(event) => setInstallDevelopment(event.currentTarget.value === "development")}
          value={installDevelopment ? "development" : "production"}
        >
          <option value="production">Production</option>
          <option value="development">Development</option>
        </select>
        <button
          disabled={disabled || installName.trim().length === 0 || !props.trusted}
          onClick={() => void props.onInstallPackage(installName, installDevelopment)}
          style={styles.action}
          type="button"
        >
          Install
        </button>
        <button
          disabled={disabled || !props.trusted}
          onClick={() => void props.onCheckOutdated()}
          style={styles.action}
          type="button"
        >
          Check outdated
        </button>
        {!props.trusted ? <span role="status">Trust the workspace to manage packages.</span> : null}
      </div>

      {props.pendingOperation ? (
        <div aria-label="Package operation preview" role="region" style={styles.preview}>
          <div>
            <strong>{props.pendingOperation.preview.description}</strong>
          </div>
          <code>
            {props.pendingOperation.preview.manager}{" "}
            {props.pendingOperation.preview.arguments.join(" ")}
          </code>
          <div style={styles.actions}>
            <button
              disabled={props.busy}
              onClick={() => void props.onConfirmOperation()}
              style={styles.action}
              type="button"
            >
              Confirm
            </button>
            <button
              disabled={props.busy}
              onClick={props.onCancelOperation}
              style={styles.action}
              type="button"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {props.error ? (
        <div role="alert" style={styles.message}>
          {props.error}
        </div>
      ) : null}
      {props.status ? (
        <div role="status" style={styles.message}>
          {props.status}
        </div>
      ) : null}
      {!props.error && props.tree.length === 0 ? (
        <div role="status" style={styles.message}>
          {props.query ? "No dependencies match the current filter." : "No dependencies declared."}
        </div>
      ) : null}

      {props.tree.length > 0 ? (
        <div aria-hidden="true" style={styles.columns}>
          <span>Name</span>
          <span>Declared</span>
          <span>Installed</span>
          <span>Status</span>
        </div>
      ) : null}

      <div aria-label="Dependency results" id={listboxId} role="listbox" style={styles.list}>
        {props.tree.map((group) => (
          <div key={group.id} role="group" aria-label={group.label}>
            <div style={styles.group}>
              {group.label} ({group.items.length})
            </div>
            {group.items.map((dependency) => {
              itemIndex += 1;
              const index = itemIndex;
              const isSelected = index === selectedIndex;
              const installedLabel = dependency.installedVersion ?? "—";
              return (
                <div key={dependency.id} style={styles.itemRow}>
                  <button
                    aria-label={`${dependency.name}, ${dependency.group}, ${dependency.status}`}
                    aria-selected={isSelected}
                    disabled={disabled}
                    id={packageDependencyOptionId(listboxId, dependency.id)}
                    onClick={() => open(dependency)}
                    onMouseMove={() => setActiveIndex(index)}
                    role="option"
                    style={isSelected ? { ...styles.item, ...styles.selected } : styles.item}
                    tabIndex={-1}
                    type="button"
                  >
                    <span style={styles.cell} title={dependency.name}>
                      {dependency.name}
                    </span>
                    <span style={styles.cell} title={`Declared ${dependency.declaredRange}`}>
                      {dependency.declaredRange}
                    </span>
                    <span style={styles.cell} title={`Installed ${installedLabel}`}>
                      {installedLabel}
                    </span>
                    <span
                      style={
                        dependency.status === "installed"
                          ? styles.statusInstalled
                          : styles.statusMissing
                      }
                    >
                      {dependency.status}
                    </span>
                  </button>
                  <div style={styles.actions}>
                    <button
                      aria-label={`Update ${dependency.name}`}
                      disabled={disabled || !props.trusted}
                      onClick={() => void props.onUpdateDependency(dependency)}
                      style={styles.action}
                      type="button"
                    >
                      Update
                    </button>
                    <button
                      aria-label={`Remove ${dependency.name}`}
                      disabled={disabled || !props.trusted}
                      onClick={() => void props.onRemoveDependency(dependency)}
                      style={styles.action}
                      type="button"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}

function packageDependencyOptionId(listboxId: string, dependencyId: string): string {
  return `${listboxId}-dependency-${dependencyId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}
