import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { Dice } from "./components/Dice";
import { CustomiseDialog } from "./components/CustomiseDialog";
import { Dialog } from "./components/Dialog";
import { MenuButton } from "./components/MenuButton";
import { Scoreboard } from "./components/Scoreboard";
import { playRoll, playTap, playWarning, setMuted } from "./audio/sounds";
import { chooseAiDice, shouldAiBank } from "./game/ai";
import { createGame, reduceGame } from "./game/gameState";
import { scoreDice } from "./game/scoring";
import { BET_GOALS, type GameState, type Mode, type PlayerId } from "./game/types";
import type { Die, DieValue } from "./game/types";
import { connectMultiplayerLobby, type MultiplayerConnection } from "./multiplayer/client";
import type { LobbyState, PublicLobby, ServerMessage } from "./multiplayer/types";
import { createRandomCustomization, readCustomizationInventory, unlockAllCustomizations, writeCustomizationInventory, type DiceCustomizationInventory } from "./customization/diceCustomization";
import { readOptions, usernameMaxLength, validateUsername, writeOptions, type PlayerOptions } from "./storage/options";
import { changeWallet, readWallet } from "./storage/wallet";
import {
  answerFriendRequest,
  addRecentPlayer,
  fetchFriendsAndRecents,
  fetchProfile,
  getLocalClientId,
  readCachedProfile,
  removeFriend,
  requestFriend,
  searchPlayers,
  setRemoteUsername,
  syncRemoteProfile,
  type PlayerProfile,
  type PlayerSummary,
  writeCachedProfile
} from "./services/profile";

type Screen = "main" | "bet" | "multiplayer" | "host" | "join" | "game";
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
  started: boolean[];
  stopped: boolean[];
};
type RematchDialog = "waiting" | "challenge" | "cancelled" | null;
type TurnTimer = { playerId: PlayerId; endsAt: number; durationMs: number };
type MultiplayerConnectStatus = "idle" | "connecting" | "failed";
type InviteNotice = "offline" | "in-game" | "full" | "sent" | { type: "rejected"; username: string } | null;
type ProfileStatus = { online: boolean; inGame: boolean };

const appVersion = "0.9.7";
const wholegrainAccountsUrl = import.meta.env.VITE_WHOLEGRAIN_ACCOUNTS_URL ?? "https://wholegrainstudios.co.uk/accounts/link";
const multiplayerRetryMs = 5_000;
const multiplayerUnavailableMs = 120_000;
const rollBaseDuration = 1.3;
const rollStartStagger = 0.1;
const rollStopStagger = 0.1;
const cheatClickCount = 10;
const cheatClickWindowMs = 5_000;

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

function PipsTitle({ compact = false, onDotClick }: { compact?: boolean; onDotClick: () => void }) {
  const dotRef = useRef<HTMLSpanElement | null>(null);
  const handlePointerDown = (event: PointerEvent<HTMLHeadingElement>) => {
    const rect = dotRef.current?.getBoundingClientRect();
    if (!rect) return;
    const insideDot =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;
    if (insideDot) onDotClick();
  };

  return (
    <h1 className={compact ? "pips-title compact-title" : "pips-title"} onPointerDown={handlePointerDown}>
      P
      <span className="pips-title-i">
        <span ref={dotRef} className="pips-title-dot" aria-hidden="true" />
        i
      </span>
      ps
    </h1>
  );
}

function CheatPanelDialog({ error, notice, onSubmit, onClose }: { error: string; notice: string; onSubmit: (code: string) => void; onClose: () => void }) {
  const [code, setCode] = useState("");
  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form
        className="account-dialog cheat-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cheat-title"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(code);
          setCode("");
        }}
      >
        <h2 id="cheat-title">Cheat Panel</h2>
        <label className="option-field">
          <span>Code</span>
          <input value={code} autoFocus autoComplete="off" spellCheck={false} onChange={(event) => setCode(event.currentTarget.value)} />
        </label>
        {error && <p className="error">{error}</p>}
        {notice && <p className="account-notice">{notice}</p>}
        <div className="dialog-actions">
          <MenuButton variant="small" onClick={onClose}>Close</MenuButton>
          <MenuButton variant="small" type="submit" disabled={!code.trim()}>OK</MenuButton>
        </div>
      </form>
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
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="rules-dialog" role="dialog" aria-modal="true" aria-labelledby="rules-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="rules-content">
          <div className="rules-overview">
            <h2 id="rules-title">Rules</h2>
            <div className="rules-copy">
              <p>Welcome to Pips! A dice game where you can push your luck to win it all!</p>
              <p>You start your turn with 6 dice, and each round you roll them!</p>
              <p>When the dice settle, you must play a scorable set of dice. If you cannot, you have BUST, and you lose everything for that turn - your active score and your held score!</p>
              <p>If you can play a scorable set, select the dice you want to play, and either hold to roll the remaining dice and push your luck, or bank to save your score and pass your turn.</p>
              <p>If you hold and you play all dice on the table, you get a fresh six dice to roll.</p>
              <p>The first player to reach the target score wins!</p>
            </div>
          </div>
          <div className="rules-list" aria-label="Scoring values">
            {rows.map((row) => (
              <div className="rule-row" key={`${row.name}-${row.score}`}>
                <span>{row.name}</span>
                <RuleDice values={row.dice} />
                <strong>{row.score}</strong>
              </div>
            ))}
          </div>
        </div>
        <div className="rules-actions">
          <MenuButton onClick={onClose}>OK</MenuButton>
        </div>
      </section>
    </div>
  );
}

function OptionsDialog({
  options,
  profile,
  onApply,
  onSetUsername,
  onLinkAccount,
  onClose
}: {
  options: PlayerOptions;
  profile: PlayerProfile | null;
  onApply: (options: PlayerOptions) => void;
  onSetUsername: () => void;
  onLinkAccount: () => void;
  onClose: () => void;
}) {
  const updateSfx = (value: boolean) => {
    onApply({ ...options, sfx: value, music: false });
  };

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="options-dialog" role="dialog" aria-modal="true" aria-labelledby="options-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="customise-heading">
          <div>
            <div className="panel-kicker">Table Rules</div>
            <h2 id="options-title">Options</h2>
          </div>
        </div>
        <div className="options-list">
          <label className="option-check">
            <input
              type="checkbox"
              checked={options.sfx}
              onChange={(event) => updateSfx(event.currentTarget.checked)}
            />
            <span>SFX</span>
          </label>
          <label className="option-check disabled">
            <input type="checkbox" checked={false} disabled readOnly />
            <span>Music</span>
          </label>
          <div className="option-field option-profile">
            <span>Username</span>
            <strong>{profile ? `${profile.username} #${profile.hash}` : "Not set"}</strong>
            <MenuButton variant="small" onClick={onSetUsername}>{profile ? "Change Username" : "Set Username"}</MenuButton>
          </div>
          <div className="option-account-actions">
            {profile?.identityId ? (
              <div className="option-field option-profile signed-in-row">
                <span>Wholegrain Account</span>
                <strong>Linked</strong>
              </div>
            ) : (
              <MenuButton variant="small" onClick={onLinkAccount}>Link Account</MenuButton>
            )}
          </div>
        </div>
        <div className="customise-actions">
          <a
            className="button button-small support-link"
            href="https://buymeacoffee.com/wholegrainstudios"
            target="_blank"
            rel="noreferrer"
          >
            <span className="button-label">
              <svg className="support-icon" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
                <path d="M11 14h24v13.5C35 35.5 30 40 23 40s-12-4.5-12-12.5V14Zm24 4h3c4 0 7 3 7 7s-3 7-7 7h-3v-5h3c1.3 0 2-0.8 2-2s-0.7-2-2-2h-3v-5ZM9 10c0-1.1 0.9-2 2-2h24c1.1 0 2 0.9 2 2s-0.9 2-2 2H11c-1.1 0-2-0.9-2-2Z" />
              </svg>
              <span>Buy me a coffee</span>
            </span>
          </a>
          <MenuButton variant="small" onClick={onClose}>
            OK
          </MenuButton>
        </div>
      </section>
    </div>
  );
}

function UsernameDialog({
  current,
  error,
  onSubmit,
  onLinkAccount,
  onClose
}: {
  current: string;
  error: string;
  onSubmit: (username: string) => void;
  onLinkAccount: () => void;
  onClose: () => void;
}) {
  const [username, setUsername] = useState(current);
  const validation = validateUsername(username);
  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="account-dialog" role="dialog" aria-modal="true" aria-labelledby="username-title" onMouseDown={(event) => event.stopPropagation()}>
        <h2 id="username-title">{current ? "Change Username" : "Set Username"}</h2>
        <label className="option-field">
          <span>Username</span>
          <input value={username} maxLength={usernameMaxLength} autoFocus onChange={(event) => setUsername(event.currentTarget.value)} />
          {(validation || error) && <small>{validation || error}</small>}
        </label>
        <div className="dialog-actions">
          <MenuButton variant="small" onClick={onClose}>Cancel</MenuButton>
          <MenuButton variant="small" disabled={Boolean(validation)} onClick={() => onSubmit(username.trim())}>OK</MenuButton>
        </div>
        {!current && (
          <p className="account-inline-prompt">
            Already have an account?{" "}
            <button className="text-link" type="button" onClick={onLinkAccount}>
              Link Wholegrain Account.
            </button>
          </p>
        )}
      </section>
    </div>
  );
}

function FriendsDialog({
  profile,
  friends,
  recents,
  requests,
  searchResults,
  searchQuery,
  error,
  statuses,
  onSearch,
  onChallenge,
  onAddFriend,
  onRemoveFriend,
  onAcceptRequest,
  onRejectRequest,
  onClose
}: {
  profile: PlayerProfile | null;
  friends: PlayerSummary[];
  recents: PlayerSummary[];
  requests: PlayerSummary[];
  searchResults: PlayerSummary[];
  searchQuery: string;
  error: string;
  statuses: Record<string, ProfileStatus>;
  onSearch: (query: string) => void;
  onChallenge: (player: PlayerSummary) => void;
  onAddFriend: (player: PlayerSummary) => void;
  onRemoveFriend: (player: PlayerSummary) => void;
  onAcceptRequest: (player: PlayerSummary) => void;
  onRejectRequest: (player: PlayerSummary) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"friends" | "recents" | "search" | "requests">("friends");
  const [friendFilter, setFriendFilter] = useState("");
  const [recentFilter, setRecentFilter] = useState("");
  const listFilter = tab === "friends" ? friendFilter : tab === "recents" ? recentFilter : "";
  const sourceRows = tab === "friends" ? friends : tab === "recents" ? recents : tab === "requests" ? requests : searchResults;
  const rows = listFilter.trim()
    ? sourceRows.filter((player) => `${player.username} #${player.hash}`.toLowerCase().includes(listFilter.trim().toLowerCase()))
    : sourceRows;
  const hasLocalSearch = tab === "friends" || tab === "recents";
  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="friends-dialog" role="dialog" aria-modal="true" aria-labelledby="friends-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="customise-heading">
          <h2 id="friends-title" className="profile-dialog-title">
            <span>{profile?.username ?? "Profile"}</span>
            {profile?.hash && <small>#{profile.hash}</small>}
          </h2>
        </div>
        <div className="customise-tabs tabs-count-4">
          <button className={tab === "friends" ? "active" : ""} onClick={() => setTab("friends")}>Friends</button>
          <button className={tab === "recents" ? "active" : ""} onClick={() => setTab("recents")}>Recents</button>
          <button className={tab === "search" ? "active" : ""} onClick={() => setTab("search")}>Search</button>
          <button className={tab === "requests" ? "active" : ""} onClick={() => setTab("requests")}>
            Requests
            {requests.length > 0 && <span className="tab-badge">{requests.length}</span>}
          </button>
        </div>
        <div className={`friends-panel-body ${tab === "search" || hasLocalSearch ? "has-search" : "no-search"}`}>
          {(tab === "search" || hasLocalSearch) && (
            <div className="friends-search-slot">
              <label className="option-field">
                <span>Search</span>
                <input
                  value={tab === "friends" ? friendFilter : tab === "recents" ? recentFilter : searchQuery}
                  onChange={(event) => {
                    if (tab === "friends") setFriendFilter(event.currentTarget.value);
                    else if (tab === "recents") setRecentFilter(event.currentTarget.value);
                    else onSearch(event.currentTarget.value);
                  }}
                  placeholder={tab === "search" ? "Name #1234" : "Filter players"}
                />
              </label>
            </div>
          )}
          <div className="friends-list">
            {error && <p className="error">{error}</p>}
            {rows.length === 0 && <p className="empty-lobbies">{tab === "search" ? "No matching players." : "No players here yet."}</p>}
            {rows.map((player) => {
              const isFriend = tab === "friends" || Boolean(player.friend) || friends.some((friend) => friend.id === player.id);
              const status = statuses[player.id];
              const online = Boolean(status?.online);
              return (
                <article className="friend-card" key={player.id}>
                  {tab === "friends" && <button className="friend-remove" aria-label={`Remove ${player.username}`} onClick={() => onRemoveFriend(player)}>x</button>}
                  <div className="friend-card-copy">
                    <strong>{player.username} <span>#{player.hash}</span></strong>
                    {isFriend && <small className={online ? "friend-online" : ""}>{online ? "Online" : "Offline"}</small>}
                  </div>
                  {tab === "requests" ? (
                    <div className="friend-request-actions">
                      <button aria-label={`Accept ${player.username}`} onClick={() => onAcceptRequest(player)}>✓</button>
                      <button aria-label={`Reject ${player.username}`} onClick={() => onRejectRequest(player)}>×</button>
                    </div>
                  ) : (
                    <MenuButton variant="small" onClick={() => (isFriend ? onChallenge(player) : onAddFriend(player))} disabled={isFriend && !online}>
                      {isFriend ? "Challenge" : "Add Friend"}
                    </MenuButton>
                  )}
                </article>
              );
            })}
          </div>
        </div>
        <div className="dialog-actions">
          <MenuButton variant="small" onClick={onClose}>Close</MenuButton>
        </div>
      </section>
    </div>
  );
}

function ConnectingDialog({ status, elapsedSeconds, onClose }: { status: MultiplayerConnectStatus; elapsedSeconds: number; onClose: () => void }) {
  const failed = status === "failed";
  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="connecting-dialog" role="dialog" aria-modal="true" aria-labelledby="connecting-title" onMouseDown={(event) => event.stopPropagation()}>
        <h2 id="connecting-title">Connecting...</h2>
        {!failed && <img className="sand-timer-large" src="/images/hourglass-transparent.gif" alt="" aria-hidden="true" />}
        {!failed && <strong className="connecting-elapsed" aria-live="polite">{elapsedSeconds}s</strong>}
        <p>{failed ? "The service could not be started now, please try again later" : "This can take up to 60 seconds"}</p>
        <MenuButton variant="small" onClick={onClose}>
          {failed ? "OK" : "Cancel"}
        </MenuButton>
      </section>
    </div>
  );
}

function TurnTimerPanel({ secondsLeft }: { secondsLeft: number }) {
  return (
    <div className={`turn-timer ${secondsLeft <= 5 ? "urgent" : ""}`} aria-live="polite">
      <span className="timer-glass" aria-hidden="true" />
      <strong key={secondsLeft}>{secondsLeft}s</strong>
    </div>
  );
}

export function App() {
  const [screen, setScreen] = useState<Screen>("main");
  const [bet, setBet] = useState(0);
  const [gold, setGold] = useState(() => readWallet());
  const [game, setGame] = useState<GameState | null>(null);
  const [playerId, setPlayerId] = useState<PlayerId>("p1");
  const [leaveDialog, setLeaveDialog] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [customiseOpen, setCustomiseOpen] = useState(false);
  const [cheatPanelOpen, setCheatPanelOpen] = useState(false);
  const [cheatError, setCheatError] = useState("");
  const [cheatNotice, setCheatNotice] = useState("");
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [usernameOpen, setUsernameOpen] = useState(false);
  const [usernameError, setUsernameError] = useState("");
  const [accountPromptOpen, setAccountPromptOpen] = useState(false);
  const [profile, setProfile] = useState<PlayerProfile | null>(() => readCachedProfile());
  const [friendsOpen, setFriendsOpen] = useState(false);
  const [friends, setFriends] = useState<PlayerSummary[]>([]);
  const [recents, setRecents] = useState<PlayerSummary[]>([]);
  const [friendRequests, setFriendRequests] = useState<PlayerSummary[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<PlayerSummary[]>([]);
  const [profileStatuses, setProfileStatuses] = useState<Record<string, ProfileStatus>>({});
  const [inviteNotice, setInviteNotice] = useState<InviteNotice>(null);
  const [incomingInvite, setIncomingInvite] = useState<{ from: string; lobbyId: string } | null>(null);
  const [opponentLeftDialog, setOpponentLeftDialog] = useState(false);
  const [friendNotice, setFriendNotice] = useState<string | null>(null);
  const [removeFriendTarget, setRemoveFriendTarget] = useState<PlayerSummary | null>(null);
  const [friendsError, setFriendsError] = useState("");
  const [longNameWarning, setLongNameWarning] = useState(false);
  const [options, setOptions] = useState<PlayerOptions>(() => readOptions());
  const [customizationInventory, setCustomizationInventory] = useState<DiceCustomizationInventory>(() => readCustomizationInventory());
  const [foundGold, setFoundGold] = useState<string | null>(null);
  const [isRolling, setIsRolling] = useState(false);
  const [rollVisual, setRollVisual] = useState<RollVisual | null>(null);
  const [multiplayerError, setMultiplayerError] = useState("");
  const [multiplayerConnectStatus, setMultiplayerConnectStatus] = useState<MultiplayerConnectStatus>("idle");
  const [lobby, setLobby] = useState<LobbyState | null>(null);
  const [publicLobbies, setPublicLobbies] = useState<PublicLobby[]>([]);
  const [joinCode, setJoinCode] = useState("");
  const [privateJoinFailed, setPrivateJoinFailed] = useState(false);
  const [turnTimer, setTurnTimer] = useState<TurnTimer | null>(null);
  const [timerNow, setTimerNow] = useState(() => Date.now());
  const [lastWarningSecond, setLastWarningSecond] = useState<number | null>(null);
  const [rematchDialog, setRematchDialog] = useState<RematchDialog>(null);
  const [rematchPurseError, setRematchPurseError] = useState(false);
  const connectionRef = useRef<MultiplayerConnection | null>(null);
  const pipsDotClicksRef = useRef<number[]>([]);
  const multiplayerConnectStatusRef = useRef<MultiplayerConnectStatus>("idle");
  const multiplayerConnectStartedAtRef = useRef(0);
  const multiplayerRetryTimerRef = useRef<number | null>(null);
  const pendingInviteRef = useRef<PlayerSummary | null>(null);
  const remoteSyncTimerRef = useRef<number | null>(null);
  const resolvedGameRef = useRef(false);
  const playerIdRef = useRef<PlayerId>("p1");
  const aiTimersRef = useRef<number[]>([]);
  const aiBusyRef = useRef(false);
  const goal = BET_GOALS[bet];
  const canAfford = gold >= bet;
  const nextGameGold =
    game?.phase === "gameOver" && game.bet > 0 && !resolvedGameRef.current
      ? gold + (game.winner === playerId ? game.bet : -game.bet)
      : gold;
  const canAffordRematch = nextGameGold >= (game?.bet ?? bet);
  const isMyTurn = game?.activePlayer === playerId;
  const timerSecondsLeft = turnTimer ? Math.min(Math.floor(turnTimer.durationMs / 1000), Math.max(0, Math.ceil((turnTimer.endsAt - timerNow) / 1000))) : 0;
  const canControlTurn = Boolean(
    game &&
      game.phase !== "gameOver" &&
      (game.mode === "singleplayer" ? game.activePlayer === "p1" : game.activePlayer === playerId)
  );
  const controlsEnabled = Boolean(canControlTurn && !isRolling);
  const selectedScoreValid = Boolean(game && selectedScoreFromDice(game) > 0);
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
    setMuted(!options.sfx);
  }, [options.sfx]);

  useEffect(() => {
    playerIdRef.current = playerId;
  }, [playerId]);

  useEffect(() => {
    return () => {
      clearAnimationTimers();
      clearAiTimers();
      clearMultiplayerRetryTimer();
      if (remoteSyncTimerRef.current !== null) window.clearTimeout(remoteSyncTimerRef.current);
      connectionRef.current?.close();
    };
  }, []);

  useEffect(() => {
    const cached = readCachedProfile();
    if (cached) {
      setProfile(cached);
      setOptions((current) => ({ ...current, username: cached.username }));
      setGold(cached.gold);
      if (cached.customization) {
        setCustomizationInventory(cached.customization);
        writeCustomizationInventory(cached.customization);
      }
    }
    fetchProfile()
      .then((remote) => {
        if (!remote) {
          setProfile(null);
          writeCachedProfile(null);
          setFriends([]);
          setRecents([]);
          setFriendRequests([]);
          setSearchResults([]);
          setProfileStatuses({});
          setOptions((current) => {
            const next = { ...current, username: "" };
            writeOptions(next);
            return next;
          });
          return;
        }
        setProfile(remote);
        writeCachedProfile(remote);
        setOptions((current) => ({ ...current, username: remote.username }));
        setGold(remote.gold);
        if (remote.customization) {
          setCustomizationInventory(remote.customization);
          writeCustomizationInventory(remote.customization);
        }
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!profile) return;
    if (remoteSyncTimerRef.current !== null) window.clearTimeout(remoteSyncTimerRef.current);
    remoteSyncTimerRef.current = window.setTimeout(() => {
      syncRemoteProfile(gold, customizationInventory)
        .then((remote) => setProfile(remote))
        .catch((error) => {
          if (error instanceof Error && error.message === "Set a username first.") {
            setProfile(null);
            writeCachedProfile(null);
          }
        });
    }, 800);
  }, [profile?.id, gold, customizationInventory]);

  useEffect(() => {
    if (!profile || !friendsOpen) return;
    refreshFriends();
  }, [profile?.id, friendsOpen]);

  useEffect(() => {
    if (!profile) return;
    refreshFriends();
  }, [profile?.id]);

  useEffect(() => {
    if (!profile) return;
    const onFocus = () => refreshFriends();
    window.addEventListener("focus", onFocus);
    const timer = window.setInterval(refreshFriends, friendsOpen ? 5_000 : 12_000);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.clearInterval(timer);
    };
  }, [profile?.id, friendsOpen]);

  useEffect(() => {
    if (!profile || !friendsOpen) return;
    const timer = window.setTimeout(() => {
      if (!searchQuery.trim()) {
        setSearchResults([]);
        return;
      }
      searchPlayers(searchQuery)
        .then(setSearchResults)
        .catch(() => setSearchResults([]));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [profile?.id, friendsOpen, searchQuery]);

  useEffect(() => {
    if (!profile || !friendsOpen) return;
    const ids = [...new Set([...friends, ...recents, ...searchResults, ...friendRequests].map((player) => player.id))];
    if (ids.length === 0) return;
    const connection = connectionRef.current ?? openProfileConnection();
    connection.send({ type: "watchProfiles", profileIds: ids });
  }, [profile?.id, friendsOpen, friends, recents, searchResults, friendRequests]);

  useEffect(() => {
    if (screen !== "join") return;
    const timer = window.setInterval(() => connectionRef.current?.send({ type: "listLobbies" }), 10_000);
    return () => window.clearInterval(timer);
  }, [screen]);

  useEffect(() => {
    const timer = window.setInterval(() => setTimerNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!turnTimer || !isMyTurn || timerSecondsLeft > 5 || timerSecondsLeft <= 0 || lastWarningSecond === timerSecondsLeft) return;
    setLastWarningSecond(timerSecondsLeft);
    playWarning();
  }, [turnTimer, isMyTurn, timerSecondsLeft, lastWarningSecond]);

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
    if (game.bet > 0) {
      const delta = game.winner === playerIdRef.current ? game.bet : -game.bet;
      setGold(changeWallet(delta));
    }
  }, [game]);

  const startSingleplayer = () => {
    if (gold < bet) return;
    resolvedGameRef.current = false;
    setPlayerId("p1");
    setGame(createGame("singleplayer", bet, goal, ["You", "Computer"], { p1: customizationInventory.equipped, p2: createRandomCustomization() }));
    setScreen("game");
  };

  const refreshFriends = () => {
    return fetchFriendsAndRecents()
      .then((data) => {
        setFriendsError("");
        setFriends(data.friends);
        setRecents(data.recents);
        setFriendRequests(data.requests ?? []);
      })
      .catch((error) => {
        setFriendsError(error instanceof Error ? error.message : "Could not load profile lists.");
      });
  };

  const saveUsername = async (username: string) => {
    setUsernameError("");
    const isInitialUsername = !profile;
    try {
      const remote = await setRemoteUsername(username, gold, customizationInventory);
      setProfile(remote);
      const nextOptions = { ...options, username: remote.username, music: false };
      setOptions(nextOptions);
      writeOptions(nextOptions);
      setGold(remote.gold);
      setUsernameOpen(false);
      if (isInitialUsername && !remote.identityId) setAccountPromptOpen(true);
    } catch (error) {
      setUsernameError(error instanceof Error ? error.message : "Could not set that username.");
    }
  };

  const openWholegrainAccountLink = () => {
    const url = new URL(wholegrainAccountsUrl);
    url.searchParams.set("game", "pips");
    url.searchParams.set("gameAccountId", profile?.id ?? getLocalClientId());
    url.searchParams.set("returnTo", window.location.href);
    window.location.href = url.toString();
  };

  const requireProfileForMultiplayer = () => {
    if (profile) return true;
    setUsernameOpen(true);
    return false;
  };

  const openLobbyConnection = () => {
    setMultiplayerError("");
    connectionRef.current?.close();
    connectionRef.current = connectMultiplayerLobby(handleMultiplayerMessage, setMultiplayerError);
    if (profile) {
      connectionRef.current.send({ type: "identify", profile: { id: profile.id, username: profile.username, hash: profile.hash } });
    }
    return connectionRef.current;
  };

  const openProfileConnection = () => {
    setMultiplayerError("");
    connectionRef.current = connectMultiplayerLobby(handleMultiplayerMessage, setMultiplayerError);
    if (profile) {
      connectionRef.current.send({ type: "identify", profile: { id: profile.id, username: profile.username, hash: profile.hash } });
    }
    return connectionRef.current;
  };

  const clearMultiplayerRetryTimer = () => {
    if (multiplayerRetryTimerRef.current !== null) {
      window.clearInterval(multiplayerRetryTimerRef.current);
      multiplayerRetryTimerRef.current = null;
    }
  };

  const attemptMultiplayerConnection = () => {
    if (multiplayerConnectStatusRef.current !== "connecting") return;
    connectionRef.current?.close();
    connectionRef.current = connectMultiplayerLobby(handleMultiplayerMessage, (message) => {
      if (message !== "" || multiplayerConnectStatusRef.current !== "connecting") return;
      clearMultiplayerRetryTimer();
      multiplayerConnectStatusRef.current = "idle";
      setMultiplayerConnectStatus("idle");
      setMultiplayerError("");
      setScreen("multiplayer");
    });
    if (profile) {
      connectionRef.current.send({ type: "identify", profile: { id: profile.id, username: profile.username, hash: profile.hash } });
    }
  };

  const cancelMultiplayerConnect = () => {
    clearMultiplayerRetryTimer();
    connectionRef.current?.close();
    connectionRef.current = null;
    multiplayerConnectStatusRef.current = "idle";
    setMultiplayerConnectStatus("idle");
    setMultiplayerError("");
    setScreen("main");
  };

  const startMultiplayerConnect = () => {
    if (!requireProfileForMultiplayer()) return;
    setLobby(null);
    setPublicLobbies([]);
    setMultiplayerError("");
    multiplayerConnectStartedAtRef.current = Date.now();
    multiplayerConnectStatusRef.current = "connecting";
    setMultiplayerConnectStatus("connecting");
    clearMultiplayerRetryTimer();
    attemptMultiplayerConnection();
    multiplayerRetryTimerRef.current = window.setInterval(() => {
      if (Date.now() - multiplayerConnectStartedAtRef.current >= multiplayerUnavailableMs) {
        clearMultiplayerRetryTimer();
        connectionRef.current?.close();
        connectionRef.current = null;
        multiplayerConnectStatusRef.current = "failed";
        setMultiplayerConnectStatus("failed");
        return;
      }
      attemptMultiplayerConnection();
    }, multiplayerRetryMs);
  };

  const hostGame = () => {
    if (!requireProfileForMultiplayer()) return;
    if (isUsernameTooLong(profile?.username ?? options.username)) {
      setLongNameWarning(true);
      return;
    }
    const connection = openLobbyConnection();
    setLobby(null);
    setScreen("host");
    connection.send({ type: "createLobby", username: profile?.username ?? options.username, profileId: profile?.id, hash: profile?.hash, bet, goal, public: false, customization: customizationInventory.equipped });
  };

  const openJoinMenu = () => {
    if (!requireProfileForMultiplayer()) return;
    if (isUsernameTooLong(profile?.username ?? options.username)) {
      setLongNameWarning(true);
      return;
    }
    const connection = openLobbyConnection();
    setLobby(null);
    setPublicLobbies([]);
    setJoinCode("");
    setScreen("join");
    connection.send({ type: "listLobbies" });
  };

  const challengeFriend = (player: PlayerSummary) => {
    if (!profile) {
      setUsernameOpen(true);
      return;
    }
    const status = profileStatuses[player.id];
    if (!status?.online) {
      setInviteNotice("offline");
      return;
    }
    if (status.inGame) {
      setInviteNotice("in-game");
      return;
    }
    pendingInviteRef.current = player;
    setFriendsOpen(false);
    const connection = openLobbyConnection();
    setLobby(null);
    setScreen("host");
    connection.send({ type: "createLobby", username: profile.username, profileId: profile.id, hash: profile.hash, bet, goal, public: false, customization: customizationInventory.equipped });
  };

  const addFriendFromDialog = async (player: PlayerSummary) => {
    try {
      await requestFriend(player.id);
      setFriendNotice(`Friend request sent to ${player.username}`);
      setSearchResults((current) => current.filter((candidate) => candidate.id !== player.id));
      refreshFriends();
    } catch {
      setFriendNotice("Could not send that friend request.");
    }
  };

  const removeFriendFromDialog = async (player: PlayerSummary) => {
    setRemoveFriendTarget(player);
  };

  const answerRequestFromDialog = async (player: PlayerSummary, accepted: boolean) => {
    try {
      await answerFriendRequest(player.id, accepted);
      setFriendRequests((current) => current.filter((request) => request.id !== player.id));
      if (accepted) setFriends((current) => current.some((friend) => friend.id === player.id) ? current : [...current, { ...player, friend: true }]);
      setFriendNotice(`You ${accepted ? "accepted" : "rejected"} ${player.username}'s friend request!`);
      refreshFriends();
    } catch {
      setFriendNotice("Could not update that friend request.");
    }
  };

  const confirmRemoveFriend = async () => {
    if (!removeFriendTarget) return;
    const target = removeFriendTarget;
    setRemoveFriendTarget(null);
    await removeFriend(target.id).catch(() => undefined);
    setFriends((current) => current.filter((friend) => friend.id !== target.id));
    refreshFriends();
  };

  const closeMenuOverlays = () => {
    setRulesOpen(false);
    setCustomiseOpen(false);
    setCheatPanelOpen(false);
    setOptionsOpen(false);
    setUsernameOpen(false);
    setAccountPromptOpen(false);
    setFriendsOpen(false);
  };

  const acceptInvite = () => {
    if (!incomingInvite || !profile) return;
    closeMenuOverlays();
    const connection = openLobbyConnection();
    connection.send({ type: "acceptInvite", lobbyId: incomingInvite.lobbyId, username: profile.username, profileId: profile.id, hash: profile.hash, customization: customizationInventory.equipped });
    setIncomingInvite(null);
  };

  const declineInvite = () => {
    if (incomingInvite) connectionRef.current?.send({ type: "declineInvite", lobbyId: incomingInvite.lobbyId });
    setIncomingInvite(null);
  };

  const handleMultiplayerMessage = (message: ServerMessage) => {
    if (message.type === "publicLobbies") setPublicLobbies(message.lobbies);
    if (message.type === "lobby") {
      setLobby(message.lobby);
      setPlayerId(message.playerId);
      playerIdRef.current = message.playerId;
      setScreen("host");
      if (message.lobby.players.length === 1 && pendingInviteRef.current) {
        connectionRef.current?.send({ type: "inviteFriend", targetProfileId: pendingInviteRef.current.id, lobbyId: message.lobby.id });
        pendingInviteRef.current = null;
      }
    }
    if (message.type === "matched") {
      resolvedGameRef.current = false;
      setTurnTimer(null);
      setPlayerId(message.playerId);
      playerIdRef.current = message.playerId;
      setBet(message.state.bet);
      setGame(localizeNames(message.state, message.playerId));
      if (message.opponentProfileId && profile) addRecentPlayer(message.opponentProfileId).catch(() => undefined);
      setScreen("game");
    }
    if (message.type === "turnTimer") {
      setTurnTimer(message);
      setLastWarningSecond(null);
      setTimerNow(Date.now());
    }
    if (message.type === "state") {
      const localized = localizeNames(message.state, playerIdRef.current);
      if (localized.phase === "gameOver") setTurnTimer(null);
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
      setTurnTimer(null);
      setBet(message.state.bet);
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
    if (message.type === "error") {
      if (message.message.includes("No lobby")) setPrivateJoinFailed(true);
      setMultiplayerError(message.message);
    }
    if (message.type === "inviteChallenge") {
      setIncomingInvite({ from: message.from.username, lobbyId: message.lobbyId });
    }
    if (message.type === "inviteUnavailable") {
      setInviteNotice(message.reason);
    }
    if (message.type === "inviteSent") setInviteNotice("sent");
    if (message.type === "inviteDeclined") setInviteNotice({ type: "rejected", username: message.from.username });
    if (message.type === "profileStatuses") {
      setProfileStatuses((current) => ({ ...current, ...message.statuses }));
    }
    if (message.type === "opponentLeft") {
      setOpponentLeftDialog(true);
      setTurnTimer(null);
    }
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
      started: finalState.dice.map((_, index) => index === 0),
      stopped: finalState.dice.map(() => false)
    });
    playRoll(finalState.dice.length, {
      rollWindowMs: rollStopMs(Math.max(0, finalState.dice.length - 1)),
      startStaggerMs: rollStartStagger * 1000
    });
    const startTimers = finalState.dice.slice(1).map((_, offset) =>
      window.setTimeout(() => {
        setRollVisual((current) => {
          if (!current) return current;
          const started = [...current.started];
          started[offset + 1] = true;
          return { ...current, started };
        });
      }, rollStartMs(offset + 1))
    );
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
    animationTimersRef.current = [...startTimers, ...stopTimers, done];
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
    setRematchPurseError(false);
    clearMultiplayerRetryTimer();
    multiplayerConnectStatusRef.current = "idle";
    setMultiplayerConnectStatus("idle");
    connectionRef.current?.close();
    connectionRef.current = null;
    setLobby(null);
    setPublicLobbies([]);
    setTurnTimer(null);
    setGame(null);
    setRollVisual(null);
    setIsRolling(false);
    clearAiTimers();
    aiBusyRef.current = false;
    setScreen("main");
    setGold(profile?.gold ?? readWallet());
  };

  const requestRematch = () => {
    if (!game) return;
    if (!canAffordRematch) {
      setRematchPurseError(true);
      return;
    }
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
    if (accepted && !canAffordRematch) {
      setRematchDialog(null);
      setRematchPurseError(true);
      return;
    }
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

  const applyOptions = (nextOptions: PlayerOptions) => {
    writeOptions(nextOptions);
    setOptions(nextOptions);
  };

  const handlePipsDotClick = useCallback(() => {
    const now = Date.now();
    pipsDotClicksRef.current = [...pipsDotClicksRef.current.filter((time) => now - time <= cheatClickWindowMs), now];
    if (pipsDotClicksRef.current.length < cheatClickCount) return;
    pipsDotClicksRef.current = [];
    setCheatError("");
    setCheatNotice("");
    setCheatPanelOpen(true);
  }, []);

  const submitCheatCode = (code: string) => {
    const normalized = code.trim().toLowerCase();
    setCheatError("");
    setCheatNotice("");
    if (normalized === "rosebud") {
      setGold(changeWallet(1000));
      setCheatNotice("Added 1000g.");
      return;
    }
    if (normalized === "monopoly") {
      const nextInventory = unlockAllCustomizations(customizationInventory);
      saveCustomizationInventory(nextInventory);
      setCheatNotice("Shop unlocked.");
      return;
    }
    setCheatError("Unknown code.");
  };

  const updateLobbyConfig = (nextBet: number, nextPublic = lobby?.public ?? false) => {
    connectionRef.current?.send({ type: "updateLobby", bet: nextBet, goal: BET_GOALS[nextBet], public: nextPublic });
  };

  const joinPrivateLobby = () => {
    if (joinCode.length !== 4) return;
    connectionRef.current?.send({ type: "joinLobby", username: profile?.username ?? options.username, profileId: profile?.id, hash: profile?.hash, code: joinCode, customization: customizationInventory.equipped });
  };

  const joinPublicLobby = (lobbyId: string) => {
    connectionRef.current?.send({ type: "joinLobby", username: profile?.username ?? options.username, profileId: profile?.id, hash: profile?.hash, lobbyId, customization: customizationInventory.equipped });
  };

  const leaveLobby = () => {
    connectionRef.current?.send({ type: "leaveLobby" });
    connectionRef.current?.close();
    connectionRef.current = null;
    setLobby(null);
    setScreen("multiplayer");
  };

  const backToMultiplayerMenu = () => {
    clearMultiplayerRetryTimer();
    multiplayerConnectStatusRef.current = "idle";
    setMultiplayerConnectStatus("idle");
    connectionRef.current?.close();
    connectionRef.current = null;
    setLobby(null);
    setPublicLobbies([]);
    setMultiplayerError("");
    setScreen("multiplayer");
  };

  const content = useMemo(() => {
    if (screen === "main") {
      return (
        <main className="menu-screen menu-home">
          <div className="hero-panel">
            <PipsTitle onDotClick={handlePipsDotClick} />
            <div className="version-number">Version: {appVersion}</div>
          </div>
          <div className="top-bar" aria-label="Player wallet">
            <GoldDisplay gold={gold} />
          </div>
          <nav className="main-actions" aria-label="Game modes">
            <MenuButton onClick={() => selectMode("singleplayer")}>Singleplayer</MenuButton>
            <MenuButton onClick={() => selectMode("multiplayer")}>Multiplayer</MenuButton>
            <MenuButton onClick={() => setCustomiseOpen(true)}>Shop</MenuButton>
          </nav>
        </main>
      );
    }

    if (screen === "bet") {
      return (
        <main className="menu-screen menu-bet">
          <div className="hero-panel compact">
            <PipsTitle compact onDotClick={handlePipsDotClick} />
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
            <p className="waiting-count waiting-count-empty" aria-hidden="true">No players awaiting match</p>
            <div className="bet-footer">
              <div className="goal-plaque">Goal: {goal}</div>
              <MenuButton disabled={!canAfford} onClick={startSingleplayer}>
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

    if (screen === "multiplayer") {
      return (
        <main className="menu-screen menu-multiplayer">
          <div className="hero-panel">
            <PipsTitle onDotClick={handlePipsDotClick} />
          </div>
          <div className="top-bar" aria-label="Player wallet">
            <GoldDisplay gold={gold} />
          </div>
          <nav className="main-actions multiplayer-choice-actions" aria-label="Multiplayer options">
            <MenuButton onClick={hostGame}>Host Game</MenuButton>
            <MenuButton onClick={openJoinMenu}>Join Game</MenuButton>
          </nav>
          <MenuButton variant="small" className="back-button" onClick={returnMain}>
            Back
          </MenuButton>
        </main>
      );
    }

    if (screen === "host" && lobby) {
      const self = lobby.players.find((candidate) => candidate.id === playerId);
      const isHost = Boolean(self?.isHost);
      return (
        <main className="menu-screen centered menu-lobby">
          <div className="top-bar" aria-label="Player wallet">
            <GoldDisplay gold={gold} />
          </div>
          <section className="lobby-panel">
            <div className="lobby-code" aria-label={`Lobby code ${lobby.code}`}>{lobby.code}</div>
            <div className="lobby-grid">
              <section className="lobby-players" aria-label="Lobby players">
                <div className="section-label">Players</div>
                {["p1", "p2"].map((slot) => {
                  const player = lobby.players.find((candidate) => candidate.id === slot);
                  if (!player) {
                    return (
                      <div className="lobby-player-card awaiting-player-card" key={slot}>
                        <button className="invite-slot-button" type="button" aria-label="Invite friends" onClick={() => setFriendsOpen(true)}>
                          +
                        </button>
                        <strong>Awaiting player</strong>
                        <span>Open seat</span>
                      </div>
                    );
                  }
                  return (
                    <div className={`lobby-player-card ${player?.ready ? "ready" : ""}`} key={slot}>
                      <strong>{`${player.username}${player.hash ? ` #${player.hash}` : ""}`}</strong>
                      <span>{`${player.isHost ? "Host - " : ""}${player.ready ? "Ready" : "Not Ready"}`}</span>
                    </div>
                  );
                })}
              </section>
              <section className={`lobby-config ${!isHost ? "locked" : ""}`} aria-label="Lobby settings">
                <div className="section-label">Stakes</div>
                <h2>Select your bet</h2>
                <div className="bet-slider-wrap">
                  <label htmlFor="lobby-bet-slider">Select Bet</label>
                  <div className="bet-slider-shell">
                    <input
                      id="lobby-bet-slider"
                      className="bet-slider"
                      type="range"
                      min="0"
                      max="30"
                      step="10"
                      value={lobby.bet}
                      disabled={!isHost}
                      onChange={(event) => updateLobbyConfig(Number(event.currentTarget.value))}
                    />
                    <output className="bet-bubble" style={getBetBubbleStyle(lobby.bet)}>
                      {lobby.bet}g
                    </output>
                  </div>
                </div>
                <label className="option-check public-toggle">
                  <input
                    type="checkbox"
                    checked={lobby.public}
                    disabled={!isHost}
                    onChange={(event) => updateLobbyConfig(lobby.bet, event.currentTarget.checked)}
                  />
                  <span>Public</span>
                </label>
                <div className="goal-plaque">Goal: {lobby.goal}</div>
              </section>
            </div>
            <div className="lobby-actions">
              <MenuButton variant="small" onClick={leaveLobby}>Leave</MenuButton>
              <MenuButton variant="small" onClick={() => connectionRef.current?.send({ type: "setReady", ready: !self?.ready })}>
                {self?.ready ? "Not Ready" : "Ready"}
              </MenuButton>
            </div>
          </section>
        </main>
      );
    }

    if (screen === "host") {
      return (
        <main className="menu-screen centered menu-lobby host-loading-screen">
          <div className="top-bar" aria-label="Player wallet">
            <GoldDisplay gold={gold} />
          </div>
          <section className="wait-panel host-loading-panel">
            <div className="loading-sigil" aria-hidden="true" />
            <div className="panel-kicker">Noticeboard</div>
            <h2>Preparing a Table...</h2>
            <MenuButton variant="small" onClick={backToMultiplayerMenu}>
              Cancel
            </MenuButton>
          </section>
        </main>
      );
    }

    if (screen === "join") {
      return (
        <main className="menu-screen centered menu-lobby">
          <div className="top-bar" aria-label="Player wallet">
            <GoldDisplay gold={gold} />
          </div>
          <section className="join-panel">
            <div className="join-grid">
              <section className="join-section" aria-label="Private lobby">
                <span className="section-label">Private</span>
                <div className="private-join-header">
                  <label className="code-entry" aria-label="Private lobby code">
                    <input
                      value={joinCode}
                      maxLength={4}
                      autoFocus
                      onChange={(event) => setJoinCode(event.currentTarget.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4))}
                      autoComplete="off"
                    />
                    {[0, 1, 2, 3].map((index) => <span key={index}>{joinCode[index] ?? ""}</span>)}
                  </label>
                  <MenuButton variant="small" disabled={joinCode.length !== 4} onClick={joinPrivateLobby}>Join</MenuButton>
                </div>
              </section>
              <section className="join-section" aria-label="Public lobbies">
                <div className="public-list-heading">
                  <span className="section-label">Public</span>
                  <MenuButton variant="small" onClick={() => connectionRef.current?.send({ type: "listLobbies" })}>Refresh</MenuButton>
                </div>
                <div className="public-lobby-list">
                  {publicLobbies.length === 0 && <p className="empty-lobbies">No public games are waiting.</p>}
                  {publicLobbies.map((publicLobby) => (
                    <article className="public-lobby-card" key={publicLobby.id}>
                      <strong className="public-lobby-host">{publicLobby.host}</strong>
                      <div className="public-lobby-meta">
                        <span>{publicLobby.bet}g</span>
                        <span>Goal {publicLobby.goal}</span>
                      </div>
                      <MenuButton variant="small" onClick={() => joinPublicLobby(publicLobby.id)}>Join</MenuButton>
                    </article>
                  ))}
                </div>
              </section>
            </div>
            {multiplayerError && <p className="error">{multiplayerError}</p>}
          </section>
          <MenuButton variant="small" className="back-button" onClick={backToMultiplayerMenu}>
            Back
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
              <MenuButton variant="small" className="back-button" onClick={() => game.phase === "gameOver" ? returnMain() : setLeaveDialog(true)}>
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
                {game.mode === "multiplayer" && turnTimer && game.phase !== "gameOver" && (
                  <TurnTimerPanel secondsLeft={timerSecondsLeft} />
                )}
              </div>
              <div className={`dice-tray dice-count-${renderedDice.length} ${isRolling ? "dice-tray-rolling" : ""}`} aria-label="Dice tray">
                {renderedDice.map((die, index) => (
                  <Dice
                    key={die.id}
                    die={die}
                    rolling={Boolean(isRolling && rollVisual?.started[index] && !rollVisual?.stopped[index])}
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
                  <MenuButton onClick={requestRematch}>
                    Rematch
                  </MenuButton>
                  <MenuButton onClick={returnMain}>Main Menu</MenuButton>
                </div>
              ) : (
                <div className="game-actions" aria-label="Turn actions">
                  {hasRolledThisTurn ? (
                    <>
                      <MenuButton disabled={!controlsEnabled || !selectedScoreValid} onClick={holdAndReroll}>
                        <span className="action-label-full">Hold and Reroll</span>
                        <span className="action-label-compact">Hold</span>
                      </MenuButton>
                      <MenuButton disabled={!controlsEnabled || !selectedScoreValid} onClick={() => sendAction("bank")}>
                        <span className="action-label-full">Bank and Pass</span>
                        <span className="action-label-compact">Bank</span>
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
  }, [screen, gold, bet, goal, canAfford, canAffordRematch, game, controlsEnabled, selectedScoreValid, hasRolledThisTurn, multiplayerError, playerId, isRolling, rollVisual, customizationInventory, options, profile, lobby, publicLobbies, joinCode, turnTimer, timerSecondsLeft, handlePipsDotClick]);

  function selectMode(nextMode: Mode) {
    if (nextMode === "multiplayer" && !profile) {
      setUsernameOpen(true);
      return;
    }
    if (nextMode === "multiplayer" && profile && isUsernameTooLong(profile.username)) {
      setLongNameWarning(true);
      return;
    }
    if (nextMode === "multiplayer") {
      startMultiplayerConnect();
      return;
    }
    setScreen("bet");
  }

  return (
    <div className="app">
      {content}
      <button
        className="options-toggle"
        type="button"
        aria-label="Options"
        onClick={() => {
          playTap();
          setOptionsOpen(true);
        }}
      >
        <span className="cog-icon" aria-hidden="true" />
      </button>
      {screen !== "game" && (
        <button
          className="friends-toggle"
          type="button"
          aria-label={profile ? `Profile ${profile.username} number ${profile.hash}` : "Profile"}
          onClick={() => {
            playTap();
            if (!profile) {
              setUsernameOpen(true);
              return;
            }
            setFriendsOpen(true);
          }}
        >
          <svg className="friends-icon" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
            <circle cx="24" cy="15" r="8" />
            <path d="M10 40c1.4-9.2 6.4-14 14-14s12.6 4.8 14 14H10Z" />
          </svg>
          <span className="profile-toggle-text">
            <span>{profile?.username ?? "Profile"}</span>
            <strong>{profile ? `#${profile.hash}` : "Set name"}</strong>
          </span>
          {friendRequests.length > 0 && <span className="profile-badge">{friendRequests.length}</span>}
        </button>
      )}
      {foundGold && (
        <Dialog title="You found 10g..." onNo={() => setFoundGold(null)} noLabel="OK">
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
        >
          {!canAffordRematch && <p>You need {game?.bet ?? bet}g to accept this rematch.</p>}
        </Dialog>
      )}
      {rematchPurseError && (
        <Dialog
          title="You do not have enough gold for this rematch."
          onNo={() => {
            setRematchPurseError(false);
            returnMain();
          }}
          noLabel="OK"
        />
      )}
      {rematchDialog === "cancelled" && (
        <Dialog title="That rematch invitation was cancelled." onNo={returnMain} noLabel="OK" />
      )}
      {rulesOpen && <RulesDialog onClose={() => setRulesOpen(false)} />}
      {multiplayerConnectStatus !== "idle" && (
        <ConnectingDialog
          status={multiplayerConnectStatus}
          elapsedSeconds={Math.max(0, Math.floor((timerNow - multiplayerConnectStartedAtRef.current) / 1000))}
          onClose={cancelMultiplayerConnect}
        />
      )}
      {longNameWarning && (
        <Dialog
          title="Your name is too long, please change it."
          onNo={() => {
            setLongNameWarning(false);
            setScreen("main");
            setOptionsOpen(true);
          }}
          noLabel="OK"
        />
      )}
      {optionsOpen && (
        <OptionsDialog
          options={options}
          profile={profile}
          onApply={applyOptions}
          onSetUsername={() => {
            setOptionsOpen(false);
            setUsernameOpen(true);
          }}
          onLinkAccount={() => {
            setOptionsOpen(false);
            openWholegrainAccountLink();
          }}
          onClose={() => setOptionsOpen(false)}
        />
      )}
      {usernameOpen && (
        <UsernameDialog
          current={profile?.username ?? ""}
          error={usernameError}
          onSubmit={saveUsername}
          onLinkAccount={() => {
            setUsernameOpen(false);
            setUsernameError("");
            openWholegrainAccountLink();
          }}
          onClose={() => setUsernameOpen(false)}
        />
      )}
      {accountPromptOpen && (
        <Dialog
          title="Would you like to link an account? This allows cross-platform play."
          onYes={() => {
            setAccountPromptOpen(false);
            openWholegrainAccountLink();
          }}
          onNo={() => setAccountPromptOpen(false)}
        />
      )}
      {friendsOpen && (
        <FriendsDialog
          profile={profile}
          friends={friends}
          recents={recents}
          requests={friendRequests}
          searchResults={searchResults}
          searchQuery={searchQuery}
          error={friendsError}
          statuses={profileStatuses}
          onSearch={setSearchQuery}
          onChallenge={challengeFriend}
          onAddFriend={addFriendFromDialog}
          onRemoveFriend={removeFriendFromDialog}
          onAcceptRequest={(player) => answerRequestFromDialog(player, true)}
          onRejectRequest={(player) => answerRequestFromDialog(player, false)}
          onClose={() => setFriendsOpen(false)}
        />
      )}
      {removeFriendTarget && (
        <Dialog
          title={`Are you sure you want to delete ${removeFriendTarget.username} as a friend?`}
          onYes={confirmRemoveFriend}
          onNo={() => setRemoveFriendTarget(null)}
        />
      )}
      {friendNotice && <Dialog title={friendNotice} onNo={() => setFriendNotice(null)} noLabel="OK" />}
      {incomingInvite && <Dialog title={`${incomingInvite.from} challenged you to a game.`} onYes={acceptInvite} onNo={declineInvite} yesLabel="Accept" noLabel="Decline" />}
      {opponentLeftDialog && <Dialog title="The opponent left the game." onNo={() => { setOpponentLeftDialog(false); returnMain(); }} noLabel="OK" />}
      {inviteNotice === "offline" && <Dialog title="That player is offline." onNo={() => setInviteNotice(null)} noLabel="OK" />}
      {inviteNotice === "in-game" && <Dialog title="This user is already in a game!" onNo={() => setInviteNotice(null)} noLabel="OK" />}
      {inviteNotice === "full" && <Dialog title="That lobby is now full." onNo={() => setInviteNotice(null)} noLabel="OK" />}
      {inviteNotice === "sent" && <Dialog title="Invitation sent." onNo={() => setInviteNotice(null)} noLabel="OK" />}
      {inviteNotice && typeof inviteNotice === "object" && <Dialog title={`${inviteNotice.username} rejected your challenge!`} onNo={() => setInviteNotice(null)} noLabel="OK" />}
      {privateJoinFailed && (
        <Dialog
          title="No private game exists for that code."
          onNo={() => {
            setPrivateJoinFailed(false);
            setMultiplayerError("");
            setScreen("multiplayer");
          }}
          noLabel="OK"
        />
      )}
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
      {cheatPanelOpen && (
        <CheatPanelDialog
          error={cheatError}
          notice={cheatNotice}
          onSubmit={submitCheatCode}
          onClose={() => setCheatPanelOpen(false)}
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
    [opponent]: { ...state.players[opponent] }
  };
  return {
    ...state,
    players,
    message: localizeMessage(state, self)
  };
}

function isUsernameTooLong(username: string) {
  return username.trim().length > usernameMaxLength;
}

function selectedScoreFromDice(state: GameState) {
  if (state.phase !== "selecting") return 0;
  return scoreDice(state.dice.filter((die) => die.selected).map((die) => die.value)).score;
}

function shouldAnimateIncomingRoll(current: GameState | null, incoming: GameState) {
  if (!current) return false;
  const incomingIsRollResult = incoming.phase === "selecting" || incoming.phase === "bust";
  return current.phase === "ready" && incomingIsRollResult && current.activePlayer === incoming.activePlayer;
}

function localizeMessage(state: GameState, self: PlayerId) {
  const activeIsSelf = state.activePlayer === self;
  const opponent = self === "p1" ? "p2" : "p1";
  const opponentName = state.players[opponent].name;
  if (state.phase === "ready") return activeIsSelf ? "Your turn" : `${opponentName}'s turn`;
  if (state.phase === "selecting") return activeIsSelf ? "You rolled" : `${opponentName} rolled`;
  if (state.phase === "bust") return activeIsSelf ? "BUST" : `${opponentName} busted`;
  if (state.phase === "gameOver") {
    if (state.winner === self) return "You win!";
    if (state.winner) return `${state.players[state.winner].name} wins!`;
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
  return Math.ceil((rollBaseDuration + Math.max(0, index) * rollStopStagger) * 1000);
}

function rollCompleteMs(diceCount: number) {
  return rollStopMs(Math.max(0, diceCount - 1)) + 80;
}

function rollDurationSeconds(index: number) {
  return rollStopMs(index) / 1000 - rollStartMs(index) / 1000;
}

function rollStartMs(index: number) {
  return Math.ceil(rollStartStagger * Math.max(0, index) * 1000);
}
