import type { ReactNode } from "react";
import { MenuButton } from "./MenuButton";

type Props = {
  title: string;
  children?: ReactNode;
  onYes?: () => void;
  onNo?: () => void;
  yesLabel?: string;
  noLabel?: string;
  yesDisabled?: boolean;
  noDisabled?: boolean;
};

export function Dialog({ title, children, onYes, onNo, yesLabel = "Yes", noLabel = "No", yesDisabled = false, noDisabled = false }: Props) {
  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onNo?.();
      }}
    >
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title" onMouseDown={(event) => event.stopPropagation()}>
        <h2 id="dialog-title">{title}</h2>
        <div className="dialog-body">{children}</div>
        <div className="dialog-actions">
          {onYes && (
            <MenuButton variant="danger" onClick={onYes} disabled={yesDisabled}>
              {yesLabel}
            </MenuButton>
          )}
          {onNo && (
            <MenuButton onClick={onNo} disabled={noDisabled}>
              {noLabel}
            </MenuButton>
          )}
        </div>
      </div>
    </div>
  );
}
