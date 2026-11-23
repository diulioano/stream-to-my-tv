import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn";

type AlertTone = "info" | "error" | "success";

const TONE_CLASSES: Record<AlertTone, string> = {
  info: "border-primary/40 bg-primary/10",
  error: "border-danger/50 bg-danger/10 text-danger",
  success: "border-success/50 bg-success/10 text-success"
};

export interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  readonly tone?: AlertTone;
  readonly title?: string;
}

export function Alert({ tone = "info", title, className, children, ...props }: AlertProps) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn("rounded-md border px-3 py-2 text-sm", TONE_CLASSES[tone], className)}
      {...props}
    >
      {title ? <p className="font-semibold">{title}</p> : null}
      {children}
    </div>
  );
}
