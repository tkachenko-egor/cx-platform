import type { HTMLAttributes } from "react";

type Variant = "neutral" | "accent" | "danger" | "warning" | "success";

const VARIANT_CLASSES: Record<Variant, string> = {
  neutral: "border-border text-muted",
  accent: "border-accent/30 bg-accent-soft text-accent",
  danger: "border-danger/30 bg-danger/10 text-danger",
  warning: "border-warning/30 bg-warning/10 text-warning",
  success: "border-success/30 bg-success/10 text-success",
};

export function Badge({ variant = "neutral", className = "", ...props }: HTMLAttributes<HTMLSpanElement> & { variant?: Variant }) {
  return <span {...props} className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${VARIANT_CLASSES[variant]} ${className}`} />;
}
