import type { ButtonHTMLAttributes, ReactNode } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: "primary" | "small" | "danger";
};

export function MenuButton({ children, variant = "primary", className = "", ...props }: Props) {
  return (
    <button className={`button button-${variant} ${className}`} {...props}>
      <span className="button-label">
        <span className="button-ornament" aria-hidden="true" />
        <span>{children}</span>
      </span>
    </button>
  );
}
