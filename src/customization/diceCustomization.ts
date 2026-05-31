export type DiceColorId =
  | "white"
  | "grey"
  | "black"
  | "red"
  | "yellow"
  | "pink"
  | "green"
  | "orange"
  | "purple"
  | "blue"
  | "brown";

export type PipShapeId = "circle" | "diamond" | "square" | "triangle";

export type DiceCustomization = {
  body: DiceColorId;
  pipColor: DiceColorId;
  pipShape: PipShapeId;
};

export type DiceCustomizationInventory = {
  equipped: DiceCustomization;
  owned: {
    body: DiceColorId[];
    pipColor: DiceColorId[];
    pipShape: PipShapeId[];
  };
};

export type DiceColorOption = {
  id: DiceColorId;
  label: string;
  value: string;
  shadow: string;
};

export type PipShapeOption = {
  id: PipShapeId;
  label: string;
};

export type CustomizationTab = "body" | "pipColor" | "pipShape";

const CUSTOMIZATION_KEY = "tavern-dice-customization";

export const CUSTOMIZATION_COST = 50;

export const diceColors: DiceColorOption[] = [
  { id: "white", label: "White", value: "#f7ecd1", shadow: "#b98f54" },
  { id: "grey", label: "Grey", value: "#8f8b83", shadow: "#48453f" },
  { id: "black", label: "Black", value: "#181511", shadow: "#050403" },
  { id: "red", label: "Red", value: "#a3382d", shadow: "#551711" },
  { id: "yellow", label: "Yellow", value: "#e2bd3f", shadow: "#8b6118" },
  { id: "pink", label: "Pink", value: "#d77aa4", shadow: "#7b314e" },
  { id: "green", label: "Green", value: "#4f8b45", shadow: "#23511f" },
  { id: "orange", label: "Orange", value: "#d7782f", shadow: "#7a3812" },
  { id: "purple", label: "Purple", value: "#7051a8", shadow: "#32215f" },
  { id: "blue", label: "Blue", value: "#3f73b8", shadow: "#193861" },
  { id: "brown", label: "Brown", value: "#795038", shadow: "#3d2518" }
];

export const pipShapes: PipShapeOption[] = [
  { id: "circle", label: "Circle" },
  { id: "diamond", label: "Diamond" },
  { id: "square", label: "Square" },
  { id: "triangle", label: "Triangle" }
];

export const defaultCustomization: DiceCustomization = {
  body: "white",
  pipColor: "black",
  pipShape: "circle"
};

export const defaultInventory: DiceCustomizationInventory = {
  equipped: defaultCustomization,
  owned: {
    body: ["white"],
    pipColor: ["black"],
    pipShape: ["circle"]
  }
};

export function readCustomizationInventory(): DiceCustomizationInventory {
  const raw = localStorage.getItem(CUSTOMIZATION_KEY);
  if (!raw) return defaultInventory;
  try {
    return normalizeInventory(JSON.parse(raw) as Partial<DiceCustomizationInventory>);
  } catch {
    return defaultInventory;
  }
}

export function writeCustomizationInventory(inventory: DiceCustomizationInventory) {
  localStorage.setItem(CUSTOMIZATION_KEY, JSON.stringify(normalizeInventory(inventory)));
}

export function getColorOption(id: DiceColorId): DiceColorOption {
  return diceColors.find((option) => option.id === id) ?? diceColors[0];
}

export function createRandomCustomization(): DiceCustomization {
  const body = randomItem(diceColors).id;
  const pipChoices = diceColors.filter((option) => option.id !== body);
  return {
    body,
    pipColor: randomItem(pipChoices).id,
    pipShape: randomItem(pipShapes).id
  };
}

function normalizeInventory(inventory: Partial<DiceCustomizationInventory>): DiceCustomizationInventory {
  const body = normalizeOwned(inventory.owned?.body, diceColors.map((option) => option.id), "white");
  const pipColor = normalizeOwned(inventory.owned?.pipColor, diceColors.map((option) => option.id), "black");
  const pipShape = normalizeOwned(inventory.owned?.pipShape, pipShapes.map((option) => option.id), "circle");
  const equipped = {
    body: body.includes(inventory.equipped?.body as DiceColorId) ? (inventory.equipped?.body as DiceColorId) : "white",
    pipColor: pipColor.includes(inventory.equipped?.pipColor as DiceColorId) ? (inventory.equipped?.pipColor as DiceColorId) : "black",
    pipShape: pipShape.includes(inventory.equipped?.pipShape as PipShapeId) ? (inventory.equipped?.pipShape as PipShapeId) : "circle"
  };
  if (equipped.body === equipped.pipColor) {
    equipped.pipColor = pipColor.find((color) => color !== equipped.body) ?? "black";
  }
  return { equipped, owned: { body, pipColor, pipShape } };
}

function normalizeOwned<T extends string>(saved: unknown, allowed: T[], required: T): T[] {
  const values = Array.isArray(saved) ? saved : [];
  return Array.from(new Set([required, ...values.filter((value): value is T => allowed.includes(value as T))]));
}

function randomItem<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}
