export function laravelFacadeTargetClassName(className: string): string | null {
  const normalizedClassName = className.replace(/^\\+/, "").toLowerCase();

  return LARAVEL_FACADE_TARGETS[normalizedClassName] ?? null;
}

const LARAVEL_FACADE_TARGETS: Record<string, string> = {
  "illuminate\\support\\facades\\app": "Illuminate\\Contracts\\Foundation\\Application",
  "illuminate\\support\\facades\\cache": "Illuminate\\Cache\\CacheManager",
  "illuminate\\support\\facades\\config": "Illuminate\\Config\\Repository",
  "illuminate\\support\\facades\\db": "Illuminate\\Database\\DatabaseManager",
  "illuminate\\support\\facades\\event": "Illuminate\\Events\\Dispatcher",
  "illuminate\\support\\facades\\file": "Illuminate\\Filesystem\\Filesystem",
  "illuminate\\support\\facades\\gate": "Illuminate\\Contracts\\Auth\\Access\\Gate",
  "illuminate\\support\\facades\\log": "Psr\\Log\\LoggerInterface",
  "illuminate\\support\\facades\\queue": "Illuminate\\Queue\\QueueManager",
  "illuminate\\support\\facades\\route": "Illuminate\\Routing\\Router",
  "illuminate\\support\\facades\\schema": "Illuminate\\Database\\Schema\\Builder",
  "illuminate\\support\\facades\\storage": "Illuminate\\Filesystem\\FilesystemManager",
  "illuminate\\support\\facades\\validator": "Illuminate\\Validation\\Factory",
  "illuminate\\support\\facades\\view": "Illuminate\\View\\Factory",
};
