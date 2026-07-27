import type { VscodeProcessTaskDisplay } from "../domain/vscodeProcessTasks";
import type { VscodeProcessTasksConfigurationAction } from "./configureVscodeProcessTasks";
import type { Command, CommandContext } from "./commandRegistry";

export interface WorkbenchVscodeProcessTaskCommandsOptions {
  readonly available: boolean;
  readonly configurationAction: VscodeProcessTasksConfigurationAction | null;
  readonly configuring: boolean;
  readonly discovering: boolean;
  readonly occupied: boolean;
  readonly tasks: readonly VscodeProcessTaskDisplay[];
  readonly trusted: boolean;
  discover(): Promise<boolean>;
  configure(): Promise<boolean>;
  start(label: string): Promise<boolean>;
}

export function workbenchVscodeProcessTaskCommands({
  available,
  configurationAction,
  configure,
  configuring,
  discover,
  discovering,
  occupied,
  start,
  tasks,
  trusted,
}: WorkbenchVscodeProcessTaskCommandsOptions): Command[] {
  const enabled = (context: CommandContext): boolean =>
    context.hasWorkspace && trusted && available && !configuring && !discovering && !occupied;

  return [
    ...(configurationAction
      ? [
          {
            id: "tasks.vscode.configure",
            title:
              configurationAction === "create"
                ? "Tasks: Create tasks.json"
                : "Tasks: Open tasks.json",
            category: "Tasks",
            isEnabled: enabled,
            run: async () => {
              await configure();
            },
          } satisfies Command,
        ]
      : []),
    {
      id: "tasks.vscode.refresh",
      title: "Tasks: Refresh Tasks",
      category: "Tasks",
      isEnabled: enabled,
      run: async () => {
        await discover();
      },
    },
    ...uniqueExecutableTasks(tasks).map((task) => ({
      id: `tasks.vscode.run.${encodeURIComponent(task.label)}`,
      title: `Tasks: Run Task: ${task.label}`,
      category: "Tasks",
      isEnabled: enabled,
      run: async () => {
        await start(task.label);
      },
    })),
  ];
}

function uniqueExecutableTasks(
  tasks: readonly VscodeProcessTaskDisplay[],
): readonly VscodeProcessTaskDisplay[] {
  const labelCounts = new Map<string, number>();
  for (const task of tasks) {
    labelCounts.set(task.label, (labelCounts.get(task.label) ?? 0) + 1);
  }
  return tasks.filter((task) => task.executable && labelCounts.get(task.label) === 1);
}
