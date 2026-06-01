export type PlayerOptions = {
  username: string;
  music: boolean;
  sfx: boolean;
};

const storageKey = "tavern-dice-options";
const blockedWords = [
  "arse",
  "asshole",
  "bastard",
  "bitch",
  "bollock",
  "bullshit",
  "crap",
  "cunt",
  "damn",
  "dick",
  "douche",
  "fag",
  "fuck",
  "hitler",
  "kkk",
  "nazi",
  "prick",
  "racist",
  "shit",
  "slur",
  "twat",
  "wanker",
  "whore"
];
export const defaultOptions: PlayerOptions = {
  username: "Player",
  music: false,
  sfx: true
};

export function validateUsername(username: string) {
  const value = username.trim();
  if (!value) return "Username is required.";
  if (value.length > 16) return "Username must be 16 characters or fewer.";
  if (!/^[A-Za-z ]+$/.test(value)) return "Use letters and spaces only.";
  const normalized = value.toLowerCase().replace(/\s+/g, "");
  if (blockedWords.some((word) => normalized.includes(word))) return "Choose a different username.";
  return "";
}

export function isDefaultUsername(username: string) {
  return username.trim().toLowerCase() === defaultOptions.username.toLowerCase();
}

export function readOptions(): PlayerOptions {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return defaultOptions;
    const parsed = JSON.parse(raw) as Partial<PlayerOptions>;
    return {
      username: typeof parsed.username === "string" && !validateUsername(parsed.username) ? parsed.username.trim() : defaultOptions.username,
      music: false,
      sfx: typeof parsed.sfx === "boolean" ? parsed.sfx : defaultOptions.sfx
    };
  } catch {
    return defaultOptions;
  }
}

export function writeOptions(options: PlayerOptions) {
  localStorage.setItem(storageKey, JSON.stringify({ ...options, music: false }));
}
