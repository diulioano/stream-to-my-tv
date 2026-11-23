import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn";

export type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info";

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: "border-border text-muted",
  success: "border-success/50 bg-success/15 text-success",
  warning: "border-warning/50 bg-warning/15 text-warning",
  danger: "border-danger/50 bg-danger/15 text-danger",
  info: "border-primary/50 bg-primary/15 text-primary"
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  readonly tone?: BadgeTone;
}

export function Badge({ tone = "neutral", className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        TONE_CLASSES[tone],
        className
      )}
      {...props}
    />
  );
}
