import type { DieValue } from "./types";

export type ScoreResult = {
  valid: boolean;
  score: number;
};

const faceScore = (face: number) => (face === 1 ? 10 : face) * 100;

const sameSet = (dice: DieValue[], values: DieValue[]) => {
  if (dice.length !== values.length) return false;
  const sortedDice = [...dice].sort().join(",");
  const sortedValues = [...values].sort().join(",");
  return sortedDice === sortedValues;
};

export function scoreDice(selected: DieValue[]): ScoreResult {
  if (selected.length === 0) return { valid: false, score: 0 };

  const dice = [...selected].sort((a, b) => a - b);
  if (sameSet(dice, [1, 2, 3, 4, 5, 6])) return { valid: true, score: 1500 };
  if (sameSet(dice, [1, 2, 3, 4, 5])) return { valid: true, score: 500 };
  if (sameSet(dice, [2, 3, 4, 5, 6])) return { valid: true, score: 750 };

  const counts = new Map<DieValue, number>();
  for (const die of dice) counts.set(die, (counts.get(die) ?? 0) + 1);

  let score = 0;
  for (const [face, count] of counts) {
    if (count >= 3) {
      score += faceScore(face) * 2 ** (count - 3);
    } else if (face === 1) {
      score += count * 100;
    } else if (face === 5) {
      score += count * 50;
    } else {
      return { valid: false, score: 0 };
    }
  }

  return score > 0 ? { valid: true, score } : { valid: false, score: 0 };
}

export function rollHasScoreableDice(roll: DieValue[]): boolean {
  if (roll.length === 0) return false;
  if (roll.includes(1) || roll.includes(5)) return true;

  const counts = new Map<DieValue, number>();
  for (const die of roll) {
    const count = (counts.get(die) ?? 0) + 1;
    if (count >= 3) return true;
    counts.set(die, count);
  }

  return (
    sameSet(roll as DieValue[], [1, 2, 3, 4, 5]) ||
    sameSet(roll as DieValue[], [2, 3, 4, 5, 6]) ||
    sameSet(roll as DieValue[], [1, 2, 3, 4, 5, 6])
  );
}

export function highestScoringSelection(roll: DieValue[]): DieValue[] {
  let best: DieValue[] = [];
  let bestScore = 0;
  const totalMasks = 1 << roll.length;

  for (let mask = 1; mask < totalMasks; mask += 1) {
    const selection = roll.filter((_, index) => mask & (1 << index));
    const result = scoreDice(selection);
    if (result.valid && result.score > bestScore) {
      best = selection;
      bestScore = result.score;
    }
  }

  return best;
}

export function scoringSelections(roll: DieValue[]): Array<{ dice: DieValue[]; score: number }> {
  const selections = new Map<string, { dice: DieValue[]; score: number }>();
  const totalMasks = 1 << roll.length;

  for (let mask = 1; mask < totalMasks; mask += 1) {
    const dice = roll.filter((_, index) => mask & (1 << index));
    const result = scoreDice(dice);
    if (!result.valid) continue;

    const key = [...dice].sort((a, b) => a - b).join(",");
    const existing = selections.get(key);
    if (!existing || result.score > existing.score) {
      selections.set(key, { dice, score: result.score });
    }
  }

  return [...selections.values()];
}
