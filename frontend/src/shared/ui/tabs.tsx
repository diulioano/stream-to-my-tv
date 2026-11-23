import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "../lib/cn";

export interface TabItem<T extends string> {
  readonly value: T;
  readonly label: string;
}

export interface TabsProps<T extends string> {
  readonly label: string;
  readonly items: readonly TabItem<T>[];
  readonly value: T;
  readonly onValueChange: (value: T) => void;
  readonly children: ReactNode;
}

export function Tabs<T extends string>({ label, items, value, onValueChange, children }: TabsProps<T>) {
  const baseId = useId();
  const listRef = useRef<HTMLDivElement>(null);

  function activate(index: number) {
    const item = items[(index + items.length) % items.length];
    if (!item) return;
    onValueChange(item.value);
    listRef.current?.querySelector<HTMLButtonElement>(`[data-value="${item.value}"]`)?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const current = items.findIndex((item) => item.value === value);
    if (event.key === "ArrowRight") activate(current + 1);
    else if (event.key === "ArrowLeft") activate(current - 1);
    else return;
    event.preventDefault();
  }

  return (
    <div>
      <div
        ref={listRef}
        role="tablist"
        aria-label={label}
        onKeyDown={handleKeyDown}
        className="inline-flex rounded-md border border-border bg-surface-muted p-1"
      >
        {items.map((item) => {
          const selected = item.value === value;
          return (
            <button
              key={item.value}
              type="button"
              role="tab"
              id={`${baseId}-tab-${item.value}`}
              data-value={item.value}
              aria-selected={selected}
              aria-controls={`${baseId}-panel`}
              tabIndex={selected ? 0 : -1}
              onClick={() => {
                onValueChange(item.value);
              }}
              className={cn(
                "rounded px-3 py-1 text-xs font-medium focus-visible:outline-2 focus-visible:outline-primary",
                selected ? "bg-primary text-primary-foreground" : "text-muted hover:text-foreground"
              )}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={`${baseId}-panel`} aria-labelledby={`${baseId}-tab-${value}`} className="mt-3">
        {children}
      </div>
    </div>
  );
}
