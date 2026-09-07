import { useId, useMemo, useState } from "react";
import { FolderGit2 } from "lucide-react";
import { AgentPickerMenu } from "./AgentPickerMenu";
import { agentPickerOption } from "./agentPickerOption";
import type { AgentSurfaceHistoryProps } from "./AgentSurfaceHistory";
import { AgentHistoryContent } from "./AgentHistoryContent";
import type { AgentHistoryRepositories } from "./agentHistoryRepositories";

export function AgentHistoryRepositoryBrowser({
  repositories,
  ...props
}: AgentSurfaceHistoryProps & { readonly repositories: AgentHistoryRepositories }) {
  const [value, setValue] = useState(repositories.defaultValue);
  const id = useId();
  const searchIdentity = useMemo(
    () => ({ identity: repositories.identity }),
    [repositories.identity],
  );
  const [options, setOptions] = useState(() => pickerOptions(repositories));
  if (
    options.length !== repositories.options.length ||
    options.some((option, index) => {
      const current = repositories.options[index];
      return (
        current?.value !== option.value ||
        current.label !== option.label ||
        current.description !== option.description
      );
    })
  )
    setOptions(pickerOptions(repositories));
  const selected = repositories.options.find((option) => option.value === value);
  return (
    <section className="agent-history-browser" aria-label="Repository history">
      <div className="agent-history-browser__picker">
        <span className="agent-history__metadata">History in {repositories.projectLabel}</span>
        <AgentPickerMenu
          id={id}
          label="History repository"
          options={options}
          value={selected?.value ?? repositories.defaultValue}
          disabled={false}
          tone={null}
          prefix={null}
          describedBy={null}
          align="start"
          menuLayout="checkout"
          searchIdentity={searchIdentity}
          onChange={setValue}
        />
        <span className="agent-history__metadata">{selected?.description}</span>
      </div>
      <div className="agent-history-browser__content">
        <AgentHistoryContent
          {...props}
          scope={
            selected?.scope ?? { kind: "unavailable", reason: "Choose an available repository." }
          }
        />
      </div>
    </section>
  );
}

function pickerOptions(repositories: AgentHistoryRepositories) {
  return repositories.options.map((option) =>
    agentPickerOption(
      option.value,
      option.label,
      option.description,
      null,
      null,
      <FolderGit2 size={15} />,
      null,
    ),
  );
}
