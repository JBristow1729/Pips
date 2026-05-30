import { highestScoringSelection } from "./scoring";
import type { DieValue, GameState } from "./types";

export function chooseAiDice(state: GameState): DieValue[] {
  return highestScoringSelection(state.dice.map((die) => die.value));
}

export function shouldAiBank(state: GameState): boolean {
  const ai = state.players.p2;
  const human = state.players.p1;
  const turnScore = ai.held + ai.current;
  if (ai.total + turnScore >= state.goal) return true;
  const behind = human.total > ai.total;
  const closeToGoal = state.goal - ai.total <= 800;
  const threshold = closeToGoal ? 350 : behind ? 650 : 500;
  return turnScore >= threshold || state.dice.length <= 2 && turnScore >= 300;
}
