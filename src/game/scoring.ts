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

const countDice = (dice: DieValue[]) => {
  const counts = new Map<DieValue, number>();
  for (const die of dice) counts.set(die, (counts.get(die) ?? 0) + 1);
  return counts;
};

const countKey = (counts: Map<DieValue, number>) =>
  ([1, 2, 3, 4, 5, 6] as DieValue[]).map((face) => counts.get(face) ?? 0).join(",");

const hasDice = (counts: Map<DieValue, number>, dice: DieValue[]) => {
  const required = countDice(dice);
  for (const [face, count] of required) {
    if ((counts.get(face) ?? 0) < count) return false;
  }
  return true;
};

const removeDice = (counts: Map<DieValue, number>, dice: DieValue[]) => {
  const next = new Map(counts);
  for (const die of dice) {
    const count = (next.get(die) ?? 0) - 1;
    if (count > 0) {
      next.set(die, count);
    } else {
      next.delete(die);
    }
  }
  return next;
};

function bestScoreForCounts(counts: Map<DieValue, number>, memo = new Map<string, number | null>()): number | null {
  if ([...counts.values()].every((count) => count === 0)) return 0;

  const key = countKey(counts);
  if (memo.has(key)) return memo.get(key) ?? null;

  const groups: Array<{ dice: DieValue[]; score: number }> = [
    { dice: [1, 2, 3, 4, 5, 6], score: 1500 },
    { dice: [2, 3, 4, 5, 6], score: 750 },
    { dice: [1, 2, 3, 4, 5], score: 500 }
  ];

  for (const face of [1, 2, 3, 4, 5, 6] as DieValue[]) {
    const count = counts.get(face) ?? 0;
    for (let length = 3; length <= count; length += 1) {
      groups.push({ dice: Array.from({ length }, () => face), score: faceScore(face) * 2 ** (length - 3) });
    }
  }

  if ((counts.get(1) ?? 0) > 0) groups.push({ dice: [1], score: 100 });
  if ((counts.get(5) ?? 0) > 0) groups.push({ dice: [5], score: 50 });

  let best: number | null = null;
  for (const group of groups) {
    if (!hasDice(counts, group.dice)) continue;

    const remainderScore = bestScoreForCounts(removeDice(counts, group.dice), memo);
    if (remainderScore === null) continue;

    const total = group.score + remainderScore;
    best = best === null ? total : Math.max(best, total);
  }

  memo.set(key, best);
  return best;
}

export function scoreDice(selected: DieValue[]): ScoreResult {
  if (selected.length === 0) return { valid: false, score: 0 };

  const dice = [...selected].sort((a, b) => a - b);
  const score = bestScoreForCounts(countDice(dice));

  return score !== null && score > 0 ? { valid: true, score } : { valid: false, score: 0 };
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
