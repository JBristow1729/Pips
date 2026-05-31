import { useEffect, useMemo, useRef, useState } from "react";
import { Dice } from "./components/Dice";
import { CustomiseDialog } from "./components/CustomiseDialog";
import { Dialog } from "./components/Dialog";
import { MenuButton } from "./components/MenuButton";
import { Scoreboard } from "./components/Scoreboard";
import { playRoll, playTap, setMuted } from "./audio/sounds";
import { chooseAiDice, shouldAiBank } from "./game/ai";
import { createGame, reduceGame } from "./game/gameState";
import { BET_GOALS, type GameState, type Mode, type PlayerId } from "./game/types";
import type { Die, DieValue } from "./game/types";
import { connectMultiplayer, watchMultiplayerWaitingCounts, type MultiplayerConnection } from "./multiplayer/client";
import { createRandomCustomization, readCustomizationInventory, writeCustomizationInventory, type DiceCustomizationInventory } from "./customization/diceCustomization";
import { changeWallet, readWallet } from "./storage/wallet";

type Screen = "main" | "bet" | "matchmaking" | "game";
type RollMotion = {
  axisX: string;
  axisY: string;
  axisZ: string;
  turns: string;
  duration: string;
};
type RollVisual = {
  dice: Die[];
  motions: RollMotion[];
  stopped: boolean[];
};
type RematchDialog = "waiting" | "challenge" | "cancelled" | null;

const rollBaseDuration = 1.1;
const rollStopStagger = 0.2;

const foundPhrases = [
  "On the tavern floor!",
  "In your trouser pocket!",
  "In someone else's trouser pocket!",
  "At the bottom of your tankard!",
  "Under a suspiciously sticky table!"
];

function GoldDisplay({ gold }: { gold: number }) {
  return (
    <div className="gold-display" aria-label={`${gold} gold`}>
      <span className="coin" aria-hidden="true" />
      <span className="gold-label">Purse</span>
      <strong>{gold}g</strong>
    </div>
  );
}

function RuleDice({ values }: { values: DieValue[] }) {
  return (
    <div className="rule-dice">
      {values.map((value, index) => (
        <Dice
          key={`${value}-${index}`}
          die={{ id: `${value}-${index}`, value, selected: false }}
          disabled
          rolling={false}
          compact
          onClick={() => undefined}
        />
      ))}
    </div>
  );
}

function RulesDialog({ onClose }: { onClose: () => void }) {
  const rows: Array<{ dice: DieValue[]; name: string; score: string }> = [
    { dice: [1], name: "One", score: "100" },
    { dice: [5], name: "Five", score: "50" },
    { dice: [3, 3, 3], name: "3 of a Kind", score: "100 x dice value" },
    { dice: [3, 3, 3, 3], name: "4 of a Kind", score: "200 x dice value" },
    { dice: [3, 3, 3, 3, 3], name: "5 of a Kind", score: "400 x dice value" },
    { dice: [3, 3, 3, 3, 3, 3], name: "6 of a Kind", score: "800 x dice value" },
    { dice: [1, 2, 3, 4, 5], name: "Low Straight", score: "500" },
    { dice: [2, 3, 4, 5, 6], name: "High Straight", score: "750" },
    { dice: [1, 2, 3, 4, 5, 6], name: "Full Straight", score: "1500" }
  ];

  return (
    <div className="dialog-backdrop">
      <section className="rules-dialog" role="dialog" aria-modal="true" aria-labelledby="rules-title">
        <div className="panel-kicker">House Notice</div>
        <h2 id="rules-title">Scoring Rules</h2>
        <div className="rules-list">
          {rows.map((row) => (
            <div className="rule-row" key={`${row.name}-${row.score}`}>
              <RuleDice values={row.dice} />
              <span>{row.name}</span>
              <strong>{row.score}</strong>
            </div>
          ))}
        </div>
        <MenuButton onClick={onClose}>Close</MenuButton>
      </section>
    </div>
  );
}

export function App() {
  const [screen, setScreen] = useState<Screen>("main");
  const [mode, setMode] = useState<Mode>("singleplayer");
  const [bet, setBet] = useState(0);
  const [gold, setGold] = useState(() => readWallet());
  const [game, setGame] = useState<GameState | null>(null);
  const [playerId, setPlayerId] = useState<PlayerId>("p1");
  const [leaveDialog, setLeaveDialog] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [customiseOpen, setCustomiseOpen] = useState(false);
  const [customizationInventory, setCustomizationInventory] = useState<DiceCustomizationInventory>(() => readCustomizationInventory());
  const [foundGold, setFoundGold] = useState<string | null>(null);
  const [muted, setMutedState] = useState(false);
  const [isRolling, setIsRolling] = useState(false);
  const [rollVisual, setRollVisual] = useState<RollVisual | null>(null);
  const [multiplayerError, setMultiplayerError] = useState("");
  const [waitingCounts, setWaitingCounts] = useState<Record<number, number>>({});
  const [rematchDialog, setRematchDialog] = useState<RematchDialog>(null);
  const connectionRef = useRef<MultiplayerConnection | null>(null);
  const waitingCountsRef = useRef<MultiplayerConnection | null>(null);
  const resolvedGameRef = useRef(false);
  const playerIdRef = useRef<PlayerId>("p1");
  const aiTimersRef = useRef<number[]>([]);
  const aiBusyRef = useRef(false);
  const goal = BET_GOALS[bet];
  const canAfford = gold >= bet;
  const nextGameGold =
    game?.phase === "gameOver" && bet > 0 && !resolvedGameRef.current
      ? gold + (game.winner === playerId ? bet : -bet)
      : gold;
  const canAffordRematch = nextGameGold >= bet;
  const isMultiplayer = mode === "multiplayer";
  const isMyTurn = game?.activePlayer === playerId;
  const canControlTurn = Boolean(
    game &&
      game.phase !== "gameOver" &&
      (game.mode === "singleplayer" ? game.activePlayer === "p1" : game.activePlayer === playerId)
  );
  const controlsEnabled = Boolean(canControlTurn && !isRolling);
  const selectedScoreValid = Boolean(game && game.players[game.activePlayer].current > 0);
  const hasRolledThisTurn = Boolean(
    game &&
      (game.phase !== "ready" ||
        game.players[game.activePlayer].held > 0 ||
        game.players[game.activePlayer].current > 0 ||
        game.dice.length < 6)
  );
  const animationTimersRef = useRef<number[]>([]);

  useEffect(() => {
    if (screen === "main" && gold === 0 && !foundGold) {
      const phrase = foundPhrases[Math.floor(Math.random() * foundPhrases.length)];
      const next = changeWallet(10);
      setGold(next);
      setFoundGold(phrase);
    }
  }, [screen, gold, foundGold]);

  useEffect(() => {
    setMuted(muted);
  }, [muted]);

  useEffect(() => {
    playerIdRef.current = playerId;
  }, [playerId]);

  useEffect(() => {
    return () => {
      clearAnimationTimers();
      clearAiTimers();
      waitingCountsRef.current?.close();
      connectionRef.current?.close();
    };
  }, []);

  useEffect(() => {
    waitingCountsRef.current?.close();
    waitingCountsRef.current = null;
    if (screen !== "bet" || mode !== "multiplayer") return;

    waitingCountsRef.current = watchMultiplayerWaitingCounts(
      (counts) => setWaitingCounts(counts),
      () => setWaitingCounts({})
    );

    return () => {
      waitingCountsRef.current?.close();
      waitingCountsRef.current = null;
    };
  }, [screen, mode]);

  useEffect(() => {
    if (!game || isRolling || game.mode !== "singleplayer" || game.phase === "gameOver" || game.activePlayer !== "p2") {
      clearAiTimers();
      aiBusyRef.current = false;
      return;
    }
    if (aiBusyRef.current) return;
    const sendAi = (delay: number, fn: () => void) => {
      aiTimersRef.current.push(window.setTimeout(fn, delay));
    };

    if (game.phase === "ready") {
      aiBusyRef.current = true;
      sendAi(700, () => {
        setGame((current) => {
          if (!current) return current;
          animateToState(reduceGame(current, { type: "roll", playerId: "p2" }));
          return current;
        });
        aiBusyRef.current = false;
      });
    }

    if (game.phase === "selecting" && game.players.p2.current === 0) {
      aiBusyRef.current = true;
      const choices = chooseAiDice(game);
      const used = new Set<string>();
      let delay = 450;
      for (const value of choices) {
        const die = game.dice.find((candidate) => !used.has(candidate.id) && !candidate.selected && candidate.value === value);
        if (die) {
          used.add(die.id);
          sendAi(delay, () => {
            playTap();
            setGame((current) => current && reduceGame(current, { type: "toggleDie", playerId: "p2", dieId: die.id }));
          });
          delay += 350;
        }
      }
      sendAi(delay + 300, () => {
        setGame((current) => {
          if (!current) return current;
          return reduceGame(current, { type: shouldAiBank(current) ? "bank" : "hold", playerId: "p2" });
        });
        aiBusyRef.current = false;
      });
    }
  }, [game, isRolling]);

  useEffect(() => {
    if (!game || game.phase !== "bust" || isRolling) return;
    if (game.mode === "multiplayer") return;
    const timer = window.setTimeout(() => {
      setGame((current) => current && reduceGame(current, { type: "finishBust", playerId: current.activePlayer }));
    }, 1400);
    return () => window.clearTimeout(timer);
  }, [game, isRolling]);

  useEffect(() => {
    if (!game || game.phase !== "gameOver" || resolvedGameRef.current) return;
    resolvedGameRef.current = true;
    if (bet > 0) {
      const delta = game.winner === playerIdRef.current ? bet : -bet;
      setGold(changeWallet(delta));
    }
  }, [game, bet]);

  const startSingleplayer = () => {
    if (gold < bet) return;
    resolvedGameRef.current = false;
    setPlayerId("p1");
    setGame(createGame("singleplayer", bet, goal, ["You", "Computer"], { p1: customizationInventory.equipped, p2: createRandomCustomization() }));
    setScreen("game");
  };

  const startMultiplayer = () => {
    setMultiplayerError("");
    setScreen("matchmaking");
    setRematchDialog(null);
    waitingCountsRef.current?.close();
    waitingCountsRef.current = null;
    connectionRef.current?.close();
    connectionRef.current = connectMultiplayer(
      bet,
      goal,
      customizationInventory.equipped,
      (message) => {
        if (message.type === "matched") {
          resolvedGameRef.current = false;
          setPlayerId(message.playerId);
          playerIdRef.current = message.playerId;
          setGame(localizeNames(message.state, message.playerId));
          setScreen("game");
        }
        if (message.type === "state") {
          const localized = localizeNames(message.state, playerIdRef.current);
          setGame((current) => {
            if (shouldAnimateIncomingRoll(current, localized)) {
              animateToState(localized);
              return current;
            }
            return localized;
          });
        }
        if (message.type === "rematchWaiting") setRematchDialog("waiting");
        if (message.type === "rematchChallenge") setRematchDialog("challenge");
        if (message.type === "rematchStarted") {
          resolvedGameRef.current = false;
          setRematchDialog(null);
          setRollVisual(null);
          setIsRolling(false);
          setGame(localizeNames(message.state, playerIdRef.current));
          setScreen("game");
        }
        if (message.type === "rematchDeclined") {
          setRematchDialog(null);
          returnMain();
        }
        if (message.type === "rematchCancelled") {
          setRematchDialog(message.by === playerIdRef.current ? null : "cancelled");
        }
        if (message.type === "error") setMultiplayerError(message.message);
      },
      setMultiplayerError
    );
  };

  const sendAction = (type: "roll" | "hold" | "bank" | "forfeit", dieId?: string) => {
    if (!game) return;
    if (type !== "forfeit" && !canControlTurn) return;
    if (game.mode === "multiplayer") {
      connectionRef.current?.send(dieId ? { type: "toggleDie", dieId } : { type });
      return;
    }
    setGame(reduceGame(game, dieId ? { type: "toggleDie", playerId, dieId } : { type, playerId }));
  };

  const roll = () => {
    if (!game || game.phase !== "ready" || !controlsEnabled) return;
    if (game.mode === "multiplayer") {
      connectionRef.current?.send({ type: "roll" });
      return;
    }
    animateToState(reduceGame(game, { type: "roll", playerId }));
  };

  const holdAndReroll = () => {
    if (!game || game.phase !== "selecting" || !controlsEnabled || !selectedScoreValid) return;
    if (game.mode === "multiplayer") {
      connectionRef.current?.send({ type: "hold" });
      connectionRef.current?.send({ type: "roll" });
      return;
    }
    const heldState = reduceGame(game, { type: "hold", playerId });
    animateToState(reduceGame(heldState, { type: "roll", playerId }));
  };

  const animateToState = (finalState: GameState) => {
    clearAnimationTimers();
    const motions = finalState.dice.map((_, index) => createRollMotion(index));
    setIsRolling(true);
    setRollVisual({
      dice: finalState.dice.map((die) => ({ ...die, selected: false })),
      motions,
      stopped: finalState.dice.map(() => false)
    });
    playRoll();
    const stopTimers = finalState.dice.map((_, index) =>
      window.setTimeout(() => {
        setRollVisual((current) => {
          if (!current) return current;
          const stopped = [...current.stopped];
          stopped[index] = true;
          return { ...current, stopped };
        });
      }, rollStopMs(index))
    );
    const done = window.setTimeout(() => {
      setRollVisual(null);
      setIsRolling(false);
      setGame(finalState);
    }, rollCompleteMs(finalState.dice.length));
    animationTimersRef.current = [...stopTimers, done];
  };

  const clearAnimationTimers = () => {
    animationTimersRef.current.forEach(window.clearTimeout);
    animationTimersRef.current = [];
  };

  const clearAiTimers = () => {
    aiTimersRef.current.forEach(window.clearTimeout);
    aiTimersRef.current = [];
  };

  const leaveGame = () => {
    setLeaveDialog(false);
    if (game?.mode === "multiplayer") connectionRef.current?.send({ type: "forfeit" });
    if (game && bet > 0 && game.phase !== "gameOver") setGold(changeWallet(-bet));
    returnMain();
  };

  const returnMain = () => {
    setRematchDialog(null);
    connectionRef.current?.close();
    connectionRef.current = null;
    setGame(null);
    setRollVisual(null);
    setIsRolling(false);
    clearAiTimers();
    aiBusyRef.current = false;
    setScreen("main");
    setGold(readWallet());
  };

  const requestRematch = () => {
    if (!game || !canAffordRematch) return;
    if (game.mode === "singleplayer") {
      startSingleplayer();
      return;
    }
    connectionRef.current?.send({ type: "rematchRequest" });
  };

  const cancelRematch = () => {
    connectionRef.current?.send({ type: "rematchCancel" });
    setRematchDialog(null);
  };

  const answerRematch = (accepted: boolean) => {
    if (accepted && !canAffordRematch) return;
    connectionRef.current?.send({ type: "rematchResponse", accepted });
    if (accepted) setRematchDialog(null);
  };

  const spendGold = (amount: number) => {
    if (readWallet() < amount) return false;
    setGold(changeWallet(-amount));
    return true;
  };

  const saveCustomizationInventory = (inventory: DiceCustomizationInventory) => {
    writeCustomizationInventory(inventory);
    setCustomizationInventory(inventory);
  };

  const applyCustomizationInventory = (inventory: DiceCustomizationInventory) => {
    saveCustomizationInventory(inventory);
    setCustomiseOpen(false);
  };

  const content = useMemo(() => {
    if (screen === "main") {
      return (
        <main className="menu-screen menu-home">
          <div className="hero-panel">
            <h1>Tavern Dice</h1>
          </div>
          <div className="top-bar" aria-label="Player wallet">
            <GoldDisplay gold={gold} />
          </div>
          <nav className="main-actions" aria-label="Game modes">
            <MenuButton onClick={() => selectMode("singleplayer")}>Singleplayer</MenuButton>
            <MenuButton onClick={() => selectMode("multiplayer")}>Multiplayer</MenuButton>
            <MenuButton onClick={() => setCustomiseOpen(true)}>Customise</MenuButton>
          </nav>
        </main>
      );
    }

    if (screen === "bet") {
      return (
        <main className="menu-screen menu-bet">
          <div className="hero-panel compact">
            <h1>Tavern Dice</h1>
          </div>
          <div className="top-bar" aria-label="Player wallet">
            <GoldDisplay gold={gold} />
          </div>
          <section className="bet-panel">
            <div className="panel-kicker">Stakes</div>
            <h2>Select your bet</h2>
            <div className="bet-slider-wrap">
              <label htmlFor="bet-slider">Select Bet</label>
              <div className="bet-slider-shell">
                <input
                  id="bet-slider"
                  className="bet-slider"
                  type="range"
                  min="0"
                  max="30"
                  step="10"
                  value={bet}
                  onChange={(event) => setBet(Number(event.currentTarget.value))}
                />
                <output className="bet-bubble" style={getBetBubbleStyle(bet)}>
                  {bet}g
                </output>
              </div>
            </div>
            <p className={`waiting-count ${mode === "singleplayer" ? "waiting-count-empty" : ""}`} aria-hidden={mode === "singleplayer"}>
              {mode === "multiplayer" ? formatWaitingCount(waitingCounts[bet] ?? 0) : "No players awaiting match"}
            </p>
            <div className="bet-footer">
              <div className="goal-plaque">Goal: {goal}</div>
              <MenuButton disabled={!canAfford} onClick={mode === "singleplayer" ? startSingleplayer : startMultiplayer}>
                Play
              </MenuButton>
            </div>
          </section>
          <MenuButton variant="small" className="back-button" onClick={() => setScreen("main")} aria-label="Back">
            Back
          </MenuButton>
        </main>
      );
    }

    if (screen === "matchmaking") {
      return (
        <main className="menu-screen centered menu-matchmaking">
          <div className="top-bar" aria-label="Player wallet">
            <GoldDisplay gold={gold} />
          </div>
          <section className="wait-panel">
            <div className="loading-sigil" aria-hidden="true" />
            <div className="panel-kicker">Noticeboard</div>
            <h2>Finding a table...</h2>
            <p className="panel-copy">Waiting for another player with the same bet.</p>
            <div className="matchmaking-stats">
              <span>Bet <strong>{bet}g</strong></span>
              <span>Score <strong>{goal}</strong></span>
            </div>
            {multiplayerError && <p className="error">{multiplayerError}</p>}
          </section>
          <MenuButton variant="small" className="back-button" onClick={returnMain}>
            Cancel
          </MenuButton>
        </main>
      );
    }

    if (game) {
      const renderedDice = rollVisual ? rollVisual.dice : game.dice;
      return (
        <main className="game-screen">
          <header className="game-topbar">
            <div className="game-topbar-actions">
              <MenuButton variant="small" className="rules-button" onClick={() => setRulesOpen(true)}>
                Rules
              </MenuButton>
              <MenuButton variant="small" className="back-button" onClick={() => setLeaveDialog(true)}>
                Leave
              </MenuButton>
            </div>
            <GoldDisplay gold={gold} />
          </header>
          <section className="game-layout" aria-label="Game table">
            <aside className="players-panel" aria-label="Players">
              <Scoreboard player={game.players.p1} active={game.activePlayer === "p1"} />
              <Scoreboard player={game.players.p2} active={game.activePlayer === "p2"} />
            </aside>
            <section className="table-panel">
              <div className="table-status">
                <div className="goal-board">Goal: {game.goal}</div>
                <div className={`center-message ${game.phase === "gameOver" ? "winner" : ""}`} role="status" aria-live="polite">
                  {game.message}
                </div>
              </div>
              <div className={`dice-tray dice-count-${renderedDice.length} ${isRolling ? "dice-tray-rolling" : ""}`} aria-label="Dice tray">
                {renderedDice.map((die, index) => (
                  <Dice
                    key={die.id}
                    die={die}
                    rolling={Boolean(isRolling && !rollVisual?.stopped[index])}
                    rollMotion={rollVisual?.motions[index]}
                    disabled={!controlsEnabled || game.phase !== "selecting"}
                    customization={game.players[game.activePlayer].diceCustomization}
                    onClick={() => {
                      playTap();
                      sendAction("roll", die.id);
                    }}
                  />
                ))}
              </div>
              {game.phase === "gameOver" ? (
                <div className="game-actions game-over-actions" aria-label="Game over actions">
                  <MenuButton disabled={!canAffordRematch} onClick={requestRematch}>
                    Rematch
                  </MenuButton>
                  <MenuButton onClick={returnMain}>Main Menu</MenuButton>
                </div>
              ) : (
                <div className="game-actions" aria-label="Turn actions">
                  {hasRolledThisTurn ? (
                    <>
                      <MenuButton disabled={!controlsEnabled || !selectedScoreValid} onClick={holdAndReroll}>
                        Hold and Reroll
                      </MenuButton>
                      <MenuButton disabled={!controlsEnabled || !selectedScoreValid} onClick={() => sendAction("bank")}>
                        Bank and Pass
                      </MenuButton>
                    </>
                  ) : (
                    <MenuButton disabled={!controlsEnabled || game.phase !== "ready"} onClick={roll}>
                      Roll
                    </MenuButton>
                  )}
                </div>
              )}
            </section>
          </section>
        </main>
      );
    }

    return null;
  }, [screen, gold, mode, bet, goal, canAfford, canAffordRematch, game, controlsEnabled, selectedScoreValid, hasRolledThisTurn, multiplayerError, playerId, isMultiplayer, isMyTurn, isRolling, rollVisual, customizationInventory, waitingCounts]);

  function selectMode(nextMode: Mode) {
    setMode(nextMode);
    setScreen("bet");
  }

  return (
    <div className="app">
      {content}
      <button className="mute-toggle" onClick={() => setMutedState((value) => !value)} aria-label="Toggle mute">
        {muted ? "Sound Off" : "Sound On"}
      </button>
      {foundGold && (
        <Dialog title="You found 10g..." onNo={() => setFoundGold(null)} noLabel="Nice">
          <p>{foundGold}</p>
        </Dialog>
      )}
      {leaveDialog && (
        <Dialog title="Are you sure you want to leave and forfeit your bet?" onYes={leaveGame} onNo={() => setLeaveDialog(false)} />
      )}
      {rematchDialog === "waiting" && <Dialog title="Waiting for the other player..." onNo={cancelRematch} noLabel="Cancel" />}
      {rematchDialog === "challenge" && (
        <Dialog
          title="You have been challenged to a rematch, do you accept?"
          onYes={() => answerRematch(true)}
          onNo={() => answerRematch(false)}
          yesDisabled={!canAffordRematch}
        >
          {!canAffordRematch && <p>You need {bet}g to accept this rematch.</p>}
        </Dialog>
      )}
      {rematchDialog === "cancelled" && (
        <Dialog title="That rematch invitation was cancelled." onNo={returnMain} noLabel="OK" />
      )}
      {rulesOpen && <RulesDialog onClose={() => setRulesOpen(false)} />}
      {customiseOpen && (
        <CustomiseDialog
          gold={gold}
          inventory={customizationInventory}
          onApply={applyCustomizationInventory}
          onPurchase={saveCustomizationInventory}
          onSpendGold={spendGold}
          onClose={() => setCustomiseOpen(false)}
        />
      )}
    </div>
  );
}

function localizeNames(state: GameState, self: PlayerId): GameState {
  const opponent = self === "p1" ? "p2" : "p1";
  const players = {
    ...state.players,
    [self]: { ...state.players[self], name: "You" },
    [opponent]: { ...state.players[opponent], name: "Opponent" }
  };
  return {
    ...state,
    players,
    message: localizeMessage(state, self)
  };
}

function shouldAnimateIncomingRoll(current: GameState | null, incoming: GameState) {
  if (!current) return false;
  const incomingIsRollResult = incoming.phase === "selecting" || incoming.phase === "bust";
  return current.phase === "ready" && incomingIsRollResult && current.activePlayer === incoming.activePlayer;
}

function localizeMessage(state: GameState, self: PlayerId) {
  const activeIsSelf = state.activePlayer === self;
  if (state.phase === "ready") return activeIsSelf ? "Your turn" : "Opponent's turn";
  if (state.phase === "selecting") return activeIsSelf ? "You rolled" : "Opponent rolled";
  if (state.phase === "bust") return activeIsSelf ? "BUST" : "Opponent busted";
  if (state.phase === "gameOver") {
    if (state.winner === self) return "You win!";
    if (state.winner) return "Opponent wins!";
  }
  return state.message;
}

function getBetBubbleStyle(bet: number) {
  const ratio = bet / 30;
  return { left: `calc(16px + ${ratio * 100}% - ${ratio * 32}px)` };
}

function formatWaitingCount(count: number) {
  if (count === 0) return "No players awaiting match";
  if (count === 1) return "1 Player awaiting match";
  return `${count} Players awaiting match`;
}

function createRollMotion(index: number): RollMotion {
  const axis = randomRollAxis();
  const direction = Math.random() < 0.5 ? -1 : 1;
  const rotations = 3 + Math.floor(Math.random() * 3);
  const wobble = Math.floor(Math.random() * 120) - 60;
  const turns = direction * (rotations * 360 + wobble);
  return {
    axisX: axis.x.toFixed(2),
    axisY: axis.y.toFixed(2),
    axisZ: axis.z.toFixed(2),
    turns: `${turns}deg`,
    duration: `${rollDurationSeconds(index).toFixed(1)}s`
  };
}

function randomRollAxis() {
  const raw = {
    x: randomAxisComponent(),
    y: randomAxisComponent(),
    z: randomAxisComponent()
  };
  const length = Math.hypot(raw.x, raw.y, raw.z) || 1;
  return {
    x: raw.x / length,
    y: raw.y / length,
    z: raw.z / length
  };
}

function randomAxisComponent() {
  const magnitude = 0.35 + Math.random() * 0.75;
  return Math.random() < 0.5 ? -magnitude : magnitude;
}

function rollStopMs(index: number) {
  return Math.ceil(rollDurationSeconds(index) * 1000);
}

function rollCompleteMs(diceCount: number) {
  return rollStopMs(Math.max(0, diceCount - 1)) + 80;
}

function rollDurationSeconds(index: number) {
  return rollBaseDuration + Math.max(0, index) * rollStopStagger;
}
