import type { ReactNode } from "react";
import { MenuButton } from "./MenuButton";

type Props = {
  title: string;
  children?: ReactNode;
  onYes?: () => void;
  onNo?: () => void;
  yesLabel?: string;
  noLabel?: string;
};

export function Dialog({ title, children, onYes, onNo, yesLabel = "Yes", noLabel = "No" }: Props) {
  return (
    <div className="dialog-backdrop">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <h2 id="dialog-title">{title}</h2>
        <div className="dialog-body">{children}</div>
        <div className="dialog-actions">
          {onNo && <MenuButton onClick={onNo}>{noLabel}</MenuButton>}
          {onYes && (
            <MenuButton variant="danger" onClick={onYes}>
              {yesLabel}
            </MenuButton>
          )}
        </div>
      </div>
    </div>
  );
}
