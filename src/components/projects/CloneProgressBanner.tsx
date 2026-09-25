import { Download, TriangleAlert, X } from "lucide-react";
import { Button } from "../../ui/foundation/Button";
import { ComposerBanner } from "../../ui/foundation/ComposerBanner";
import { IconButton } from "../../ui/foundation/IconButton";
import type { CloneBannerModel } from "./cloneBannerModel";
import "./projectBanners.css";

export interface CloneProgressBannerProps {
  readonly model: CloneBannerModel;
  onCancel(): void;
  onRetry(): void;
  onRemove(): void;
  onHide(): void;
}

export function CloneProgressBanner({
  model,
  onCancel,
  onHide,
  onRemove,
  onRetry,
}: CloneProgressBannerProps) {
  const hide = (
    <IconButton
      icon={<X size={12} />}
      label="Close clone draft"
      onClick={onHide}
      size="xs"
      title="Hide"
    />
  );
  switch (model.kind) {
    case "none":
      return null;
    case "preparing":
      return (
        <ComposerBanner actions={hide} tone="working">
          <span className="cv-clone-banner__line">
            <strong>{model.title}</strong>
          </span>
        </ComposerBanner>
      );
    case "running":
      return (
        <ComposerBanner
          actions={
            <>
              {model.percent === null ? null : (
                <span
                  aria-label="Clone progress"
                  aria-valuemax={100}
                  aria-valuemin={0}
                  aria-valuenow={model.percent}
                  className="cv-clone-banner__track"
                  role="progressbar"
                >
                  <span style={{ width: `${model.percent}%` }} />
                </span>
              )}
              <Button onClick={onCancel} size="sm" variant="ghost">
                Cancel
              </Button>
              {hide}
            </>
          }
          tone="working"
        >
          <span className="cv-clone-banner__line">
            <strong>{model.title}</strong>
            <span>{model.summary}</span>
          </span>
        </ComposerBanner>
      );
    case "failed":
    case "cancelled":
      return (
        <ComposerBanner
          actions={
            <>
              <Button onClick={onRemove} size="sm" variant="ghost">
                Remove project
              </Button>
              {model.retryable ? (
                <Button onClick={onRetry} size="sm" variant="ghost">
                  Retry
                </Button>
              ) : null}
              {hide}
            </>
          }
          icon={
            model.kind === "failed" ? (
              <span className="cv-clone-banner__icon--danger">
                <TriangleAlert size={14} />
              </span>
            ) : (
              <Download size={14} />
            )
          }
        >
          <span className="cv-clone-banner__stack">
            <strong>{model.title}</strong>
            <span>
              {model.detail.text}
              {model.detail.command === null ? null : (
                <>
                  {" "}
                  <code>{model.detail.command}</code> {model.detail.tail}
                </>
              )}
            </span>
          </span>
        </ComposerBanner>
      );
    default:
      return unsupportedBanner(model);
  }
}

function unsupportedBanner(model: never): never {
  throw new TypeError(`Unsupported clone banner: ${JSON.stringify(model)}.`);
}
