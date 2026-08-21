import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg shadow-sm hover:brightness-110 active:brightness-95",
  secondary: "border border-border bg-surface text-fg shadow-sm hover:bg-bg",
  ghost: "text-muted hover:bg-bg hover:text-fg",
  danger: "border border-danger/30 bg-surface text-danger shadow-sm hover:bg-danger/5",
};

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-all disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT_CLASSES[variant]} ${className}`}
    />
  );
}
