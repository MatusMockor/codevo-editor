import { ChevronRight, ShieldCheck } from "lucide-react";
import { Button } from "../../ui/foundation/Button";
import { ComposerBanner } from "../../ui/foundation/ComposerBanner";
import "./projectBanners.css";

export function ProjectTrustBanner({ onReview }: { onReview(): void }) {
  return (
    <ComposerBanner
      actions={
        <Button onClick={onReview} size="sm" variant="ghost">
          Review
          <ChevronRight aria-hidden="true" size={12} />
        </Button>
      }
      icon={<ShieldCheck size={14} />}
    >
      <span className="cv-clone-banner__line">
        <strong>Not trusted yet</strong>
        <span>Agents start here once you trust this project</span>
      </span>
    </ComposerBanner>
  );
}
