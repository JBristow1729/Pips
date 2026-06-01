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
  "cock",
  "crap",
  "cunt",
  "damn",
  "dick",
  "douche",
  "fag",
  "fuck",
  "fuk",
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
const blockedPatterns = [
  /a+rs+e+/,
  /a+s+h+o+l+e+/,
  /b+a+s+t+a+r+d+/,
  /b+i+t+c+h+/,
  /b+o+l+l+o+c+k+/,
  /c+o+c*k+/,
  /c+u+n+t+/,
  /d+i+c+k+/,
  /d+o+u+c+h+e+/,
  /f+a+g+/,
  /f+u+c*k+(e+r+|i+n*g*)?/,
  /f+c+k+(i+n*g*)?/,
  /h+i+t+l+e+r+/,
  /m+c*s+u+c+k+/,
  /n+a+z+i+/,
  /p+r+i+c+k+/,
  /s+h+i+t+/,
  /s+u+c+k+(i+n*g*)?/,
  /t+w+a+t+/,
  /w+a+n+k+e*r+/,
  /w+h+o+r+e+/
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
  const normalized = normalizeUsernameForModeration(value);
  const skeleton = normalized.replace(/[aeiou]/g, "");
  const inappropriate = blockedWords.some((word) => {
    const cleanWord = normalizeUsernameForModeration(word);
    return normalized.includes(cleanWord) || skeleton.includes(cleanWord.replace(/[aeiou]/g, ""));
  });
  if (inappropriate || blockedPatterns.some((pattern) => pattern.test(normalized))) {
    return "That username is considered inappropriate, please select another.";
  }
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

function normalizeUsernameForModeration(value: string) {
  return value
    .toLowerCase()
    .replace(/[013457@$]/g, (char) => ({ "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s" }[char] ?? char))
    .replace(/[^a-z]/g, "");
}
