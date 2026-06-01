import { useMemo, useState } from "react";
import { CUSTOMIZATION_COST, diceColors, pipShapes, type CustomizationTab, type DiceColorId, type DiceCustomization, type DiceCustomizationInventory, type PipShapeId } from "../customization/diceCustomization";
import type { DieValue } from "../game/types";
import { Dialog } from "./Dialog";
import { Dice } from "./Dice";
import { MenuButton } from "./MenuButton";

type Props = {
  gold: number;
  inventory: DiceCustomizationInventory;
  onApply: (inventory: DiceCustomizationInventory) => void;
  onPurchase: (inventory: DiceCustomizationInventory) => void;
  onSpendGold: (amount: number) => boolean;
  onClose: () => void;
};

type PurchaseTarget =
  | { tab: "body"; id: DiceColorId; label: string }
  | { tab: "pipColor"; id: DiceColorId; label: string }
  | { tab: "pipShape"; id: PipShapeId; label: string };

const previewValues: DieValue[] = [1, 2, 3, 4, 5, 6];

export function CustomiseDialog({ gold, inventory, onApply, onPurchase, onSpendGold, onClose }: Props) {
  const [activeTab, setActiveTab] = useState<CustomizationTab>("body");
  const [draft, setDraft] = useState<DiceCustomization>(inventory.equipped);
  const [owned, setOwned] = useState(inventory.owned);
  const [purchaseTarget, setPurchaseTarget] = useState<PurchaseTarget | null>(null);
  const [cancelWarning, setCancelWarning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const hasChanges = !sameCustomization(draft, inventory.equipped);

  const draftInventory = useMemo<DiceCustomizationInventory>(() => ({ equipped: draft, owned }), [draft, owned]);

  const requestClose = () => {
    if (hasChanges) {
      setCancelWarning(true);
      return;
    }
    onClose();
  };

  const selectBody = (id: DiceColorId, label: string) => {
    if (!owned.body.includes(id)) {
      setPurchaseTarget({ tab: "body", id, label });
      return;
    }
    if (id === draft.pipColor) {
      setNotice("Body and pip colour cannot be the same.");
      return;
    }
    setDraft((current) => ({ ...current, body: id }));
  };

  const selectPipColor = (id: DiceColorId, label: string) => {
    if (!owned.pipColor.includes(id)) {
      setPurchaseTarget({ tab: "pipColor", id, label });
      return;
    }
    if (id === draft.body) {
      setNotice("Body and pip colour cannot be the same.");
      return;
    }
    setDraft((current) => ({ ...current, pipColor: id }));
  };

  const selectPipShape = (id: PipShapeId, label: string) => {
    if (!owned.pipShape.includes(id)) {
      setPurchaseTarget({ tab: "pipShape", id, label });
      return;
    }
    setDraft((current) => ({ ...current, pipShape: id }));
  };

  const confirmPurchase = () => {
    if (!purchaseTarget) return;
    if (!onSpendGold(CUSTOMIZATION_COST)) {
      setPurchaseTarget(null);
      setNotice("You need more gold for that customisation.");
      return;
    }
    const nextOwned = {
      ...owned,
      [purchaseTarget.tab]: [...owned[purchaseTarget.tab], purchaseTarget.id]
    };
    setOwned(nextOwned);
    onPurchase({ equipped: inventory.equipped, owned: nextOwned });
    setPurchaseTarget(null);
  };

  return (
    <div className="dialog-backdrop">
      <section className="customise-dialog" role="dialog" aria-modal="true" aria-labelledby="customise-title">
        <div className="customise-heading">
          <div>
            <div className="panel-kicker">Dice Chest</div>
            <h2 id="customise-title">Customise Dice</h2>
          </div>
          <div className="customise-purse" aria-label={`${gold} gold available`}>
            {gold}g
          </div>
        </div>

        <div className="customise-preview" aria-label="Dice customisation preview">
          {previewValues.map((value) => (
            <Dice
              key={value}
              die={{ id: `preview-${value}`, value, selected: false }}
              disabled
              rolling={false}
              compact
              interactive={false}
              customization={draft}
              onClick={() => undefined}
            />
          ))}
        </div>

        <div className="customise-tabs" role="tablist" aria-label="Customisation categories">
          <button className={activeTab === "body" ? "active" : ""} type="button" role="tab" aria-selected={activeTab === "body"} onClick={() => setActiveTab("body")}>
            Body
          </button>
          <button className={activeTab === "pipColor" ? "active" : ""} type="button" role="tab" aria-selected={activeTab === "pipColor"} onClick={() => setActiveTab("pipColor")}>
            Pip Colour
          </button>
          <button className={activeTab === "pipShape" ? "active" : ""} type="button" role="tab" aria-selected={activeTab === "pipShape"} onClick={() => setActiveTab("pipShape")}>
            Pip Shape
          </button>
        </div>

        <div className="customise-options">
          {activeTab === "body" &&
            diceColors.map((option) => (
              <OptionCard
                key={option.id}
                label={option.label}
                status={getStatus(owned.body.includes(option.id), draft.body === option.id)}
                preview={{ ...draft, body: option.id }}
                onClick={() => selectBody(option.id, option.label)}
              />
            ))}
          {activeTab === "pipColor" &&
            diceColors.map((option) => (
              <OptionCard
                key={option.id}
                label={option.label}
                status={getStatus(owned.pipColor.includes(option.id), draft.pipColor === option.id)}
                preview={{ ...draft, pipColor: option.id }}
                onClick={() => selectPipColor(option.id, option.label)}
              />
            ))}
          {activeTab === "pipShape" &&
            pipShapes.map((option) => (
              <OptionCard
                key={option.id}
                label={option.label}
                status={getStatus(owned.pipShape.includes(option.id), draft.pipShape === option.id)}
                preview={{ ...draft, pipShape: option.id }}
                onClick={() => selectPipShape(option.id, option.label)}
              />
            ))}
        </div>

        <div className="customise-actions">
          <MenuButton variant="small" onClick={requestClose}>
            Cancel
          </MenuButton>
          <MenuButton variant="small" disabled={!hasChanges} onClick={() => onApply(draftInventory)}>
            Apply
          </MenuButton>
        </div>
      </section>

      {purchaseTarget && (
        <Dialog
          title={`Purchase ${purchaseTarget.label} for ${CUSTOMIZATION_COST}g?`}
          yesLabel="Purchase"
          noLabel="Cancel"
          onYes={confirmPurchase}
          onNo={() => setPurchaseTarget(null)}
        />
      )}
      {cancelWarning && (
        <Dialog title="Discard your dice changes?" yesLabel="Discard" noLabel="Keep Editing" onYes={onClose} onNo={() => setCancelWarning(false)}>
          <p>Unapplied changes will be lost.</p>
        </Dialog>
      )}
      {notice && (
        <Dialog title={notice} noLabel="OK" onNo={() => setNotice(null)} />
      )}
    </div>
  );
}

function OptionCard({ label, preview, status, onClick }: { label: string; preview: DiceCustomization; status: string; onClick: () => void }) {
  return (
    <button className={`customise-card ${status === "Equipped" ? "equipped" : ""}`} type="button" onClick={onClick}>
      <Dice
        die={{ id: `card-${label}`, value: 5, selected: false }}
        disabled
        rolling={false}
        compact
        interactive={false}
        customization={preview}
        onClick={() => undefined}
      />
      <span className="customise-card-name">{label}</span>
      <strong>{status}</strong>
    </button>
  );
}

function getStatus(owned: boolean, equipped: boolean) {
  if (equipped) return "Equipped";
  if (owned) return "Owned";
  return `${CUSTOMIZATION_COST}g`;
}

function sameCustomization(left: DiceCustomization, right: DiceCustomization) {
  return left.body === right.body && left.pipColor === right.pipColor && left.pipShape === right.pipShape;
}
