import type { DiceCustomizationInventory } from "../customization/diceCustomization";

export type PlayerProfile = {
  id: string;
  identityId: string | null;
  username: string;
  hash: string;
  gold: number;
  customization: DiceCustomizationInventory | null;
};

export type PlayerSummary = {
  id: string;
  username: string;
  hash: string;
  friend?: boolean;
};

const localClientIdKey = "pips-client-id";
const localProfileKey = "pips-profile";
const localClientCookieName = "pips_client_id";
const localClientIdMaxAgeSeconds = 60 * 60 * 24 * 730;

export function getLocalClientId() {
  const cached = readCachedProfile();
  if (cached?.id) {
    setLocalClientId(cached.id);
    return cached.id;
  }
  const current = localStorage.getItem(localClientIdKey);
  if (current) {
    writeLocalClientCookie(current);
    return current;
  }
  const cookieId = readLocalClientCookie();
  if (cookieId) {
    localStorage.setItem(localClientIdKey, cookieId);
    return cookieId;
  }
  const next = `local-${crypto.randomUUID()}`;
  setLocalClientId(next);
  return next;
}

export function setLocalClientId(id: string) {
  localStorage.setItem(localClientIdKey, id);
  writeLocalClientCookie(id);
}

export async function fetchProfile() {
  const body = await requestProfile<{ profile: PlayerProfile | null }>("/.netlify/functions/pips-profile?action=profile");
  if (body.profile) writeCachedProfile(body.profile);
  return body.profile ?? readCachedProfile();
}

export function readCachedProfile(): PlayerProfile | null {
  try {
    const raw = localStorage.getItem(localProfileKey);
    return raw ? (JSON.parse(raw) as PlayerProfile) : null;
  } catch {
    return null;
  }
}

export function writeCachedProfile(profile: PlayerProfile | null) {
  if (!profile) {
    localStorage.removeItem(localProfileKey);
    return;
  }
  localStorage.setItem(localProfileKey, JSON.stringify(profile));
  setLocalClientId(profile.id);
}

export async function setRemoteUsername(username: string, gold: number, customization: DiceCustomizationInventory) {
  const body = await requestProfile<{ profile: PlayerProfile }>("/.netlify/functions/pips-profile?action=username", {
    method: "POST",
    body: JSON.stringify({ username, gold, customization })
  });
  writeCachedProfile(body.profile);
  return body.profile;
}

export async function syncRemoteProfile(gold: number, customization: DiceCustomizationInventory) {
  const body = await requestProfile<{ profile: PlayerProfile }>("/.netlify/functions/pips-profile?action=profile", {
    method: "PATCH",
    body: JSON.stringify({ gold, customization })
  });
  writeCachedProfile(body.profile);
  return body.profile;
}

export async function fetchFriendsAndRecents() {
  return requestProfile<{ friends: PlayerSummary[]; recents: PlayerSummary[]; requests: PlayerSummary[] }>("/.netlify/functions/pips-profile?action=friends");
}

export async function searchPlayers(query: string) {
  const body = await requestProfile<{ results: PlayerSummary[] }>(`/.netlify/functions/pips-profile?action=search&q=${encodeURIComponent(query)}`);
  return body.results;
}

export async function addFriend(friendId: string) {
  await requestProfile("/.netlify/functions/pips-profile?action=friend", {
    method: "POST",
    body: JSON.stringify({ friendId })
  });
}

export async function requestFriend(friendId: string) {
  await requestProfile("/.netlify/functions/pips-profile?action=friend-request", {
    method: "POST",
    body: JSON.stringify({ friendId })
  });
}

export async function answerFriendRequest(friendId: string, accepted: boolean) {
  await requestProfile("/.netlify/functions/pips-profile?action=friend-request", {
    method: "PATCH",
    body: JSON.stringify({ friendId, accepted })
  });
}

export async function removeFriend(friendId: string) {
  await requestProfile("/.netlify/functions/pips-profile?action=friend", {
    method: "DELETE",
    body: JSON.stringify({ friendId })
  });
}

export async function addRecentPlayer(otherId: string) {
  await requestProfile("/.netlify/functions/pips-profile?action=recent", {
    method: "POST",
    body: JSON.stringify({ otherId })
  });
}

async function requestProfile<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  headers.set("x-pips-client-id", getLocalClientId());
  const cachedProfileId = readCachedProfile()?.id;
  if (cachedProfileId) headers.set("x-pips-profile-id", cachedProfileId);
  const response = await fetch(url, { ...init, headers, cache: "no-store" });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "Profile service is unavailable.");
  }
  return (await response.json()) as T;
}

function readLocalClientCookie() {
  const prefix = `${localClientCookieName}=`;
  const value = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length);
  if (!value) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function writeLocalClientCookie(id: string) {
  document.cookie = `${localClientCookieName}=${encodeURIComponent(id)}; Max-Age=${localClientIdMaxAgeSeconds}; Path=/; SameSite=Lax`;
}
