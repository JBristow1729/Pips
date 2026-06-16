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

export type PipShapeId = "circle" | "diamond" | "square" | "triangle" | "cross" | "plus";
export type DiceTextureId = "default" | "wood" | "glass" | "marble" | "obsidian" | "bone";

export type DiceCustomization = {
  body: DiceColorId;
  pipColor: DiceColorId;
  pipShape: PipShapeId;
  texture: DiceTextureId;
};

export type DiceCustomizationInventory = {
  equipped: DiceCustomization;
  owned: {
    body: DiceColorId[];
    pipColor: DiceColorId[];
    pipShape: PipShapeId[];
    texture: DiceTextureId[];
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

export type DiceTextureOption = {
  id: DiceTextureId;
  label: string;
  overlay: string;
  opacity: string;
  blendMode: string;
};

export type CustomizationTab = "body" | "pipColor" | "pipShape" | "texture";

const CUSTOMIZATION_KEY = "pips-customization";

export const CUSTOMIZATION_COST = 50;
export const TEXTURE_CUSTOMIZATION_COST = 75;

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
  { id: "triangle", label: "Triangle" },
  { id: "cross", label: "Cross" },
  { id: "plus", label: "Plus" }
];

export const diceTextures: DiceTextureOption[] = [
  { id: "default", label: "Default", overlay: "none", opacity: "0", blendMode: "normal" },
  {
    id: "wood",
    label: "Wood",
    overlay:
      "repeating-linear-gradient(-38deg, rgba(95, 54, 24, 0.44) 0 3px, rgba(236, 178, 93, 0.22) 3px 7px, rgba(62, 33, 15, 0.34) 7px 11px), radial-gradient(ellipse at 38% 42%, transparent 0 34%, rgba(65, 35, 17, 0.32) 36% 38%, transparent 40%)",
    opacity: "0.58",
    blendMode: "multiply"
  },
  {
    id: "glass",
    label: "Glass",
    overlay:
      "linear-gradient(135deg, rgba(255, 255, 255, 0.58) 0 10%, transparent 11% 44%, rgba(255, 255, 255, 0.3) 45% 52%, transparent 53%), radial-gradient(circle at 26% 24%, rgba(255, 255, 255, 0.55), transparent 30%)",
    opacity: "0.62",
    blendMode: "screen"
  },
  {
    id: "marble",
    label: "Marble",
    overlay:
      "repeating-linear-gradient(115deg, transparent 0 11px, rgba(255, 255, 255, 0.34) 12px 14px, transparent 15px 28px), repeating-linear-gradient(32deg, rgba(43, 35, 31, 0.18) 0 2px, transparent 2px 18px)",
    opacity: "0.55",
    blendMode: "overlay"
  },
  {
    id: "obsidian",
    label: "Obsidian",
    overlay:
      "radial-gradient(circle at 28% 24%, rgba(255, 255, 255, 0.28), transparent 22%), repeating-linear-gradient(145deg, rgba(255, 255, 255, 0.12) 0 1px, transparent 1px 16px), radial-gradient(circle at 70% 78%, rgba(20, 12, 24, 0.7), transparent 42%)",
    opacity: "0.72",
    blendMode: "overlay"
  },
  {
    id: "bone",
    label: "Bone",
    overlay:
      "radial-gradient(ellipse at 24% 28%, rgba(255, 247, 210, 0.34), transparent 36%), repeating-linear-gradient(78deg, rgba(80, 52, 28, 0.16) 0 1px, transparent 1px 13px), radial-gradient(ellipse at 70% 64%, rgba(96, 67, 39, 0.22), transparent 34%)",
    opacity: "0.5",
    blendMode: "multiply"
  }
];

export const defaultCustomization: DiceCustomization = {
  body: "white",
  pipColor: "black",
  pipShape: "circle",
  texture: "default"
};

export const defaultInventory: DiceCustomizationInventory = {
  equipped: defaultCustomization,
  owned: {
    body: ["white"],
    pipColor: ["black"],
    pipShape: ["circle"],
    texture: ["default"]
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

export function unlockAllCustomizations(inventory: DiceCustomizationInventory): DiceCustomizationInventory {
  return normalizeInventory({
    equipped: inventory.equipped,
    owned: {
      body: diceColors.map((option) => option.id),
      pipColor: diceColors.map((option) => option.id),
      pipShape: pipShapes.map((option) => option.id),
      texture: diceTextures.map((option) => option.id)
    }
  });
}

export function getColorOption(id: DiceColorId): DiceColorOption {
  return diceColors.find((option) => option.id === id) ?? diceColors[0];
}

export function getTextureOption(id: DiceTextureId): DiceTextureOption {
  return diceTextures.find((option) => option.id === id) ?? diceTextures[0];
}

export function createRandomCustomization(): DiceCustomization {
  const body = randomItem(diceColors).id;
  const pipChoices = diceColors.filter((option) => option.id !== body);
  return {
    body,
    pipColor: randomItem(pipChoices).id,
    pipShape: randomItem(pipShapes).id,
    texture: randomItem(diceTextures).id
  };
}

function normalizeInventory(inventory: Partial<DiceCustomizationInventory>): DiceCustomizationInventory {
  const body = normalizeOwned(inventory.owned?.body, diceColors.map((option) => option.id), "white");
  const pipColor = normalizeOwned(inventory.owned?.pipColor, diceColors.map((option) => option.id), "black");
  const pipShape = normalizeOwned(inventory.owned?.pipShape, pipShapes.map((option) => option.id), "circle");
  const texture = normalizeOwned(inventory.owned?.texture, diceTextures.map((option) => option.id), "default");
  const equipped = {
    body: body.includes(inventory.equipped?.body as DiceColorId) ? (inventory.equipped?.body as DiceColorId) : "white",
    pipColor: pipColor.includes(inventory.equipped?.pipColor as DiceColorId) ? (inventory.equipped?.pipColor as DiceColorId) : "black",
    pipShape: pipShape.includes(inventory.equipped?.pipShape as PipShapeId) ? (inventory.equipped?.pipShape as PipShapeId) : "circle",
    texture: texture.includes(inventory.equipped?.texture as DiceTextureId) ? (inventory.equipped?.texture as DiceTextureId) : "default"
  };
  if (equipped.body === equipped.pipColor) {
    equipped.pipColor = pipColor.find((color) => color !== equipped.body) ?? "black";
  }
  return { equipped, owned: { body, pipColor, pipShape, texture } };
}

function normalizeOwned<T extends string>(saved: unknown, allowed: T[], required: T): T[] {
  const values = Array.isArray(saved) ? saved : [];
  return Array.from(new Set([required, ...values.filter((value): value is T => allowed.includes(value as T))]));
}

function randomItem<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}
