import { ListChecks, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { WorkspaceTodo } from "../domain/workspaceTodo";

interface TodoPanelProps {
  isLoading: boolean;
  isOpen: boolean;
  onClose(): void;
  onOpenTodo(todo: WorkspaceTodo): void;
  onRefresh(): void;
  todos: WorkspaceTodo[];
}

interface TodoGroup {
  filePath: string;
  relativePath: string;
  todos: WorkspaceTodo[];
}

export function TodoPanel({
  isLoading,
  isOpen,
  onClose,
  onOpenTodo,
  onRefresh,
  todos,
}: TodoPanelProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const activeRowRef = useRef<HTMLButtonElement | null>(null);
  const containerRef = useRef<HTMLElement | null>(null);
  const sortedTodos = useMemo(() => sortTodos(todos), [todos]);
  const groups = useMemo(() => groupTodos(sortedTodos), [sortedTodos]);
  const activeTodo = sortedTodos[activeIndex];

  useEffect(() => {
    if (!isOpen) {
      setActiveIndex(0);
      return;
    }

    containerRef.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    setActiveIndex((current) =>
      Math.min(current, Math.max(sortedTodos.length - 1, 0)),
    );
  }, [sortedTodos.length]);

  useEffect(() => {
    activeRowRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (!isOpen) {
    return null;
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) =>
        Math.min(current + 1, Math.max(sortedTodos.length - 1, 0)),
      );
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => Math.max(current - 1, 0));
      return;
    }

    if (event.key === "Enter" && activeTodo) {
      event.preventDefault();
      onOpenTodo(activeTodo);
    }
  };

  return (
    <div className="palette-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-label="TODO comments"
        aria-modal="true"
        className="todo-panel"
        onKeyDown={handleKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
        ref={containerRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="todo-panel-header">
          <span>
            <strong>TODO comments</strong>
            <small>{summaryLabel(isLoading, sortedTodos.length)}</small>
          </span>
          <button
            className="todo-panel-action"
            disabled={isLoading}
            onClick={onRefresh}
            title="Rescan workspace"
            type="button"
          >
            <RefreshCw aria-hidden="true" size={14} />
          </button>
        </header>

        <div className="todo-panel-results" role="listbox">
          {sortedTodos.length === 0 ? (
            <div className="todo-panel-empty">
              {isLoading ? "Scanning workspace..." : "No TODO comments"}
            </div>
          ) : null}
          {groups.map((group) => (
            <section className="todo-panel-group" key={group.filePath}>
              <h2 title={group.filePath}>{group.relativePath}</h2>
              {group.todos.map((todo) => {
                const index = sortedTodos.indexOf(todo);

                return (
                  <button
                    aria-selected={index === activeIndex}
                    className={
                      index === activeIndex
                        ? "todo-panel-row active"
                        : "todo-panel-row"
                    }
                    key={todoKey(todo)}
                    onClick={() => onOpenTodo(todo)}
                    onMouseEnter={() => setActiveIndex(index)}
                    ref={index === activeIndex ? activeRowRef : undefined}
                    role="option"
                    title={`${todo.relativePath}:${todo.line}`}
                    type="button"
                  >
                    <ListChecks aria-hidden="true" size={15} />
                    <span>
                      <strong>
                        <span className={`todo-tag ${todo.tag.toLowerCase()}`}>
                          {todo.tag}
                        </span>
                        {todo.text || todo.relativePath}
                      </strong>
                      <small>
                        {todo.relativePath}:{todo.line}
                      </small>
                    </span>
                  </button>
                );
              })}
            </section>
          ))}
        </div>
      </section>
    </div>
  );
}

function summaryLabel(isLoading: boolean, count: number): string {
  if (isLoading) {
    return "Scanning workspace...";
  }

  if (count === 0) {
    return "Nothing to do";
  }

  return count === 1 ? "1 item" : `${count} items`;
}

function sortTodos(todos: WorkspaceTodo[]): WorkspaceTodo[] {
  return [...todos].sort((left, right) => {
    const byPath = left.relativePath.localeCompare(right.relativePath);

    if (byPath !== 0) {
      return byPath;
    }

    if (left.line !== right.line) {
      return left.line - right.line;
    }

    return left.column - right.column;
  });
}

function groupTodos(todos: WorkspaceTodo[]): TodoGroup[] {
  const groups: TodoGroup[] = [];

  todos.forEach((todo) => {
    const last = groups[groups.length - 1];

    if (last && last.filePath === todo.filePath) {
      last.todos.push(todo);
      return;
    }

    groups.push({
      filePath: todo.filePath,
      relativePath: todo.relativePath,
      todos: [todo],
    });
  });

  return groups;
}

function todoKey(todo: WorkspaceTodo): string {
  return `${todo.filePath}:${todo.line}:${todo.column}:${todo.tag}`;
}
