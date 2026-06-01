import { highestScoringSelection, scoringSelections } from "./scoring";
import type { DieValue, GameState } from "./types";

type AiDifficulty = "easy" | "medium" | "hard" | "expert";

type AiConfig = {
  expectedWeight: number;
  avoidsLowTriples: boolean;
  savesSinglesAtDiceCount: number;
  bankBias: number;
  riskResponse: number;
  endgameUrgency: number;
};

const AI_CONFIGS: Record<AiDifficulty, AiConfig> = {
  easy: {
    expectedWeight: 0.05,
    avoidsLowTriples: false,
    savesSinglesAtDiceCount: 7,
    bankBias: -160,
    riskResponse: 0.2,
    endgameUrgency: 0.45
  },
  medium: {
    expectedWeight: 0.35,
    avoidsLowTriples: false,
    savesSinglesAtDiceCount: 7,
    bankBias: -40,
    riskResponse: 0.45,
    endgameUrgency: 0.75
  },
  hard: {
    expectedWeight: 0.75,
    avoidsLowTriples: true,
    savesSinglesAtDiceCount: 5,
    bankBias: 70,
    riskResponse: 0.75,
    endgameUrgency: 1
  },
  expert: {
    expectedWeight: 1,
    avoidsLowTriples: true,
    savesSinglesAtDiceCount: 4,
    bankBias: 130,
    riskResponse: 1,
    endgameUrgency: 1.25
  }
};

const DIFFICULTY_BY_BET: Record<number, AiDifficulty> = {
  0: "easy",
  10: "medium",
  20: "hard",
  30: "expert"
};

const BANK_FLOOR_BY_DICE: Record<number, number> = {
  1: 250,
  2: 300,
  3: 400,
  4: 500,
  5: 600,
  6: 750
};

export function aiDifficultyForBet(bet: number): AiDifficulty {
  return DIFFICULTY_BY_BET[bet] ?? "easy";
}

export function chooseAiDice(state: GameState): DieValue[] {
  const roll = state.dice.map((die) => die.value);
  const difficulty = aiDifficultyForBet(state.bet);
  if (difficulty === "easy") return highestScoringSelection(roll);

  const config = AI_CONFIGS[difficulty];
  const choices = scoringSelections(roll);
  if (choices.length === 0) return [];

  const ai = state.players.p2;
  const onlySingles = hasOnlySingleScorers(roll);
  const mustWinNow = ai.total + ai.held < state.goal && choices.some((choice) => ai.total + ai.held + choice.score >= state.goal);

  let best = choices[0];
  let bestValue = Number.NEGATIVE_INFINITY;

  for (const choice of choices) {
    const diceAfterChoice = remainingDiceCount(roll.length, choice.dice.length);
    const turnScoreAfterChoice = ai.held + choice.score;
    let value = choice.score + expectedContinuationBonus(diceAfterChoice, turnScoreAfterChoice) * config.expectedWeight;

    if (choice.score >= 1000) value += 120;
    if (usesAllRolledDice(roll, choice.dice)) value += 350 * config.expectedWeight;
    if (config.avoidsLowTriples && containsExactTriple(choice.dice, 2) && !mustWinNow) value -= 180;
    if (onlySingles && roll.length >= config.savesSinglesAtDiceCount && choice.dice.length > 1) value -= 130 * choice.dice.length;

    if (
      value > bestValue ||
      (value === bestValue && choice.score > best.score) ||
      (value === bestValue && choice.score === best.score && diceAfterChoice > remainingDiceCount(roll.length, best.dice.length))
    ) {
      best = choice;
      bestValue = value;
    }
  }

  return best.dice;
}

export function shouldAiBank(state: GameState): boolean {
  const ai = state.players.p2;
  const human = state.players.p1;
  const turnScore = ai.held + ai.current;
  const aiEffectiveTotal = ai.total + turnScore;
  if (aiEffectiveTotal >= state.goal) return true;

  const selectedCount = state.dice.filter((die) => die.selected).length;
  const diceAfterChoice = remainingDiceCount(state.dice.length, selectedCount);
  if (selectedCount === state.dice.length) return false;

  const difficulty = aiDifficultyForBet(state.bet);
  const config = AI_CONFIGS[difficulty];
  const futureValue = expectedContinuationBonus(diceAfterChoice, turnScore);
  const scoreGap = human.total - aiEffectiveTotal;
  const closeScoreMargin = Math.max(150, state.goal * 0.08);
  const playerNearWin = state.goal - human.total <= Math.max(250, state.goal * 0.08);
  const aiNearWin = state.goal - aiEffectiveTotal <= Math.max(350, state.goal * 0.12);
  const hasCaughtUpEnough = scoreGap <= closeScoreMargin;
  const progress = Math.min(1, aiEffectiveTotal / state.goal);
  const bankFloor = BANK_FLOOR_BY_DICE[diceAfterChoice] ?? 500;
  const comebackBankFloor = Math.max(250, bankFloorForComeback(diceAfterChoice, state.goal, scoreGap, progress));
  const riskMultiplier =
    1 +
    Math.min(0.55, Math.max(-0.45, scoreGap / state.goal)) * config.riskResponse +
    (playerNearWin && !hasCaughtUpEnough ? config.endgameUrgency : 0) +
    (aiNearWin ? config.endgameUrgency * 0.4 : 0);
  const leadConservation = Math.max(0, aiEffectiveTotal - human.total) * (0.06 + config.expectedWeight * 0.04);
  const adjustedFutureValue = futureValue * Math.max(0.3, riskMultiplier) - leadConservation + config.bankBias;

  if (scoreGap > closeScoreMargin && turnScore >= comebackBankFloor && diceAfterChoice <= 3 && !playerNearWin) return true;
  if (futureValue <= 0 && hasCaughtUpEnough && turnScore >= bankFloor) return true;
  if (playerNearWin && aiEffectiveTotal + closeScoreMargin < human.total) return false;
  return turnScore >= bankFloor && adjustedFutureValue <= 0;
}

function bankFloorForComeback(diceAfterChoice: number, goal: number, scoreGap: number, progress: number) {
  const base = BANK_FLOOR_BY_DICE[diceAfterChoice] ?? 500;
  const behindRatio = Math.max(0, scoreGap / goal);
  const catchUpDiscount = Math.min(160, behindRatio * 260 + progress * 80);
  const fewDicePenalty = diceAfterChoice <= 2 ? 80 : diceAfterChoice === 3 ? 40 : 0;
  return base - catchUpDiscount + fewDicePenalty;
}

function remainingDiceCount(rolledDiceCount: number, selectedDiceCount: number) {
  const remaining = rolledDiceCount - selectedDiceCount;
  return remaining === 0 ? 6 : remaining;
}

function usesAllRolledDice(roll: DieValue[], selection: DieValue[]) {
  return roll.length === selection.length;
}

function containsExactTriple(dice: DieValue[], face: DieValue) {
  return dice.filter((die) => die === face).length === 3;
}

function hasOnlySingleScorers(roll: DieValue[]) {
  const counts = new Map<DieValue, number>();
  for (const die of roll) counts.set(die, (counts.get(die) ?? 0) + 1);
  return [...counts.values()].every((count) => count < 3);
}

function expectedContinuationBonus(diceCount: number, turnScore: number) {
  if (diceCount >= 6) {
    if (turnScore < 1000) return 850;
    if (turnScore < 1800) return 650;
    if (turnScore < 2800) return 450;
    if (turnScore < 3800) return 250;
    return 0;
  }

  const rows: Record<number, Array<{ value: number; fromTurnScore: number }>> = {
    5: [
      { value: 300, fromTurnScore: 0 },
      { value: 250, fromTurnScore: 250 },
      { value: 200, fromTurnScore: 550 },
      { value: 150, fromTurnScore: 950 },
      { value: 100, fromTurnScore: 1600 },
      { value: 50, fromTurnScore: 2250 },
      { value: 0, fromTurnScore: 2900 }
    ],
    4: [
      { value: 200, fromTurnScore: 0 },
      { value: 150, fromTurnScore: 150 },
      { value: 100, fromTurnScore: 350 },
      { value: 50, fromTurnScore: 700 },
      { value: 0, fromTurnScore: 1000 }
    ],
    3: [
      { value: 100, fromTurnScore: 0 },
      { value: 50, fromTurnScore: 250 },
      { value: 0, fromTurnScore: 400 }
    ],
    2: [
      { value: 50, fromTurnScore: 0 },
      { value: 0, fromTurnScore: 250 }
    ],
    1: [{ value: 0, fromTurnScore: 0 }]
  };
  const row = rows[diceCount] ?? rows[1];
  return [...row].reverse().find((entry) => turnScore >= entry.fromTurnScore)?.value ?? 0;
}
