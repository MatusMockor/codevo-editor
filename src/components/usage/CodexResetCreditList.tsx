import { useEffect, useId, useRef } from "react";
import type { CodexRateLimitResetState } from "../../application/useCodexRateLimitResets";
import { Button } from "../../ui/foundation/Button";
import {
  codexResetConfirmCopy,
  type CodexResetAvailableModel,
  type CodexResetCreditRow,
  type CodexResetHistoryRow,
} from "./codexResetCreditsPresentation";

type ResetStatus = CodexRateLimitResetState["status"];

export interface CodexResetAvailablePanelProps {
  readonly model: CodexResetAvailableModel;
  readonly status: ResetStatus;
  readonly targetCreditId: string | null;
  readonly retrying: boolean;
  readonly canReset: boolean;
  readonly usageNote: string | null;
  onUse(creditId: string | null): void;
  onCancel(): void;
  onConfirm(): void;
}

export function CodexResetAvailablePanel(props: CodexResetAvailablePanelProps) {
  const { model, status, targetCreditId } = props;
  const visibleTarget =
    model.kind === "credits" && model.rows.some((row) => row.id === targetCreditId);
  const detached = visibleTarget ? null : detachedItem(props);
  switch (model.kind) {
    case "unreported":
      return (
        <>
          {detached}
          <p className="cv-codex-resets__empty">
            This account does not provide reset availability.
          </p>
        </>
      );
    case "empty":
      return (
        <>
          {detached}
          <p className="cv-codex-resets__empty">No resets available.</p>
        </>
      );
    case "countOnly":
      return (
        detached ?? (
          <ul className="cv-codex-resets__list">
            <li className="cv-codex-resets__item">
              <CreditLine
                actionLabel={actionLabel(status, targetCreditId === null)}
                canReset={props.canReset}
                meta={{ label: "Expiry dates unavailable", iso: null, title: null, soon: false }}
                onUse={() => props.onUse(null)}
                title={model.label}
              />
            </li>
          </ul>
        )
      );
    case "credits": {
      const confirming = status === "confirming";
      return (
        <>
          {detached}
          <ul className="cv-codex-resets__list">
            {model.rows.map((row) => (
              <li className="cv-codex-resets__item" key={row.id} title={row.tooltip ?? undefined}>
                {confirming && row.id === targetCreditId ? (
                  <ConfirmBox {...props} row={row} />
                ) : (
                  <CreditLine
                    actionLabel={actionLabel(status, row.id === targetCreditId)}
                    canReset={props.canReset && !row.expiry.expired}
                    meta={row.expiry}
                    onUse={() => props.onUse(row.id)}
                    title={row.title}
                  />
                )}
              </li>
            ))}
          </ul>
          {model.moreLabel === null ? null : (
            <p className="cv-codex-resets__footer">{model.moreLabel}</p>
          )}
        </>
      );
    }
    default:
      return model satisfies never;
  }
}

function detachedItem(props: CodexResetAvailablePanelProps) {
  const { retrying, status } = props;
  if (status === "confirming")
    return (
      <ul className="cv-codex-resets__list">
        <li className="cv-codex-resets__item">
          <ConfirmBox {...props} row={null} />
        </li>
      </ul>
    );
  if (!retrying || (status !== "preparing" && status !== "consuming")) return null;
  return (
    <ul className="cv-codex-resets__list">
      <li className="cv-codex-resets__item">
        <CreditLine
          actionLabel={actionLabel(status, true)}
          canReset={false}
          meta={{ label: "Result unknown", iso: null, title: null, soon: false }}
          onUse={() => undefined}
          title="Last reset"
        />
      </li>
    </ul>
  );
}

export function CodexResetHistoryPanel({
  rows,
  truncated,
}: {
  readonly rows: ReadonlyArray<CodexResetHistoryRow>;
  readonly truncated: boolean;
}) {
  return (
    <>
      {rows.length === 0 ? (
        <p className="cv-codex-resets__empty">No resets used through Codevo yet.</p>
      ) : (
        <ul className="cv-codex-resets__list">
          {rows.map((row) => (
            <li className="cv-codex-resets__item" key={row.key}>
              <span className="cv-codex-resets__text">
                <span className="cv-codex-resets__name">{row.title}</span>
                <Meta
                  meta={{ label: row.usedLabel, iso: row.iso, title: row.fullTitle, soon: false }}
                />
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="cv-codex-resets__footer">
        Only resets used through Codevo are listed. Resets used in other apps don't appear here.
        {truncated ? " Older Codevo reset records are no longer retained." : null}
      </p>
    </>
  );
}

interface MetaModel {
  readonly label: string;
  readonly iso: string | null;
  readonly title: string | null;
  readonly soon: boolean;
}

function CreditLine({
  actionLabel,
  canReset,
  meta,
  onUse,
  title,
}: {
  readonly actionLabel: string;
  readonly canReset: boolean;
  readonly meta: MetaModel;
  readonly onUse: () => void;
  readonly title: string;
}) {
  const id = useId();
  return (
    <>
      <span className="cv-codex-resets__text" id={id}>
        <span className="cv-codex-resets__name">{title}</span>
        <Meta meta={meta} />
      </span>
      <Button aria-describedby={id} disabled={!canReset} onClick={onUse} size="sm">
        {actionLabel}
      </Button>
    </>
  );
}

function Meta({ meta }: { readonly meta: MetaModel }) {
  return (
    <span className="cv-codex-resets__meta" data-tone={meta.soon ? "warning" : undefined}>
      {meta.iso === null ? (
        meta.label
      ) : (
        <time dateTime={meta.iso} title={meta.title ?? undefined}>
          {meta.label}
        </time>
      )}
    </span>
  );
}

function ConfirmBox({
  onCancel,
  onConfirm,
  retrying,
  row,
  usageNote,
}: CodexResetAvailablePanelProps & { readonly row: CodexResetCreditRow | null }) {
  const copy = codexResetConfirmCopy(row, retrying, usageNote);
  const groupRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    groupRef.current?.querySelector("button")?.focus();
  }, []);
  return (
    <div
      aria-label="Confirm Codex limit reset"
      className="cv-codex-resets__confirm"
      ref={groupRef}
      role="group"
    >
      <p className="cv-codex-resets__question">{copy.question}</p>
      <p className="cv-codex-resets__detail">{copy.detail}</p>
      <span className="cv-codex-resets__actions">
        <Button onClick={onCancel} size="sm" variant="ghost">
          Cancel
        </Button>
        <Button onClick={onConfirm} size="sm" variant="primary">
          {copy.action}
        </Button>
      </span>
    </div>
  );
}

function actionLabel(status: ResetStatus, isTarget: boolean): string {
  if (isTarget && status === "preparing") return "Preparing…";
  if (isTarget && status === "consuming") return "Resetting…";
  return "Use reset";
}
