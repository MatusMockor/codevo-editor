import { Gauge, X } from "lucide-react";
import { ComposerBanner } from "../../../ui/foundation/ComposerBanner";
import { IconButton } from "../../../ui/foundation/IconButton";
import { useNowMs } from "../../../ui/foundation/useNowMs";
import { UsageLimitBars } from "../../usage/UsageLimitBars";
import { usageProviderLabel } from "../../usage/usagePresentation";
import type { ComposerUsageLimitsNotice } from "./useComposerUsageLimitsNotice";

const MAX_NOTICE_WINDOWS = 3;

export function AgentComposerUsageLimitsNotice({
  notice,
}: {
  readonly notice: ComposerUsageLimitsNotice;
}) {
  if (!notice.visible) return null;
  return <VisibleUsageLimitsNotice notice={notice} />;
}

function VisibleUsageLimitsNotice({ notice }: { readonly notice: ComposerUsageLimitsNotice }) {
  const nowEpochMs = useNowMs();
  const single = notice.providers.length === 1 ? notice.providers[0] : undefined;
  return (
    <ComposerBanner
      actions={
        <IconButton
          icon={<X aria-hidden="true" size={14} />}
          label="Dismiss usage limits"
          onClick={notice.dismiss}
          size="xs"
        />
      }
      announce={false}
      icon={<Gauge aria-hidden="true" size={14} />}
    >
      <span className="agent-usage-notice">
        <span className="agent-usage-notice__title">
          Usage limits
          <span className="agent-usage-notice__summary">
            {single === undefined
              ? `${notice.providers.length} providers`
              : usageProviderLabel(single.provider)}
          </span>
        </span>
        {notice.providers.map((entry) => (
          <span className="agent-usage-notice__provider" key={entry.provider}>
            {single === undefined ? (
              <span className="agent-usage-notice__summary">
                {usageProviderLabel(entry.provider)}
              </span>
            ) : null}
            <UsageLimitBars
              compact
              maxVisible={MAX_NOTICE_WINDOWS}
              nowEpochMs={nowEpochMs}
              observedAtEpochMs={entry.observedAtEpochMs}
              windows={entry.windows}
            />
          </span>
        ))}
      </span>
    </ComposerBanner>
  );
}
