import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from "react";
import { playTap } from "../audio/sounds";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: "primary" | "small" | "danger";
};

export function MenuButton({ children, variant = "primary", className = "", onClick, disabled, ...props }: Props) {
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (disabled) return;
    playTap();
    onClick?.(event);
  };

  return (
    <button className={`button button-${variant} ${className}`} disabled={disabled} onClick={handleClick} {...props}>
      <span className="button-label">
        <span className="button-ornament" aria-hidden="true" />
        <span>{children}</span>
      </span>
    </button>
  );
}
