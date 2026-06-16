import type { DiceCustomizationInventory } from "../customization/diceCustomization";
import { readIdentitySession } from "./auth";

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

export function getLocalClientId() {
  const current = localStorage.getItem(localClientIdKey);
  if (current) return current;
  const next = `local-${crypto.randomUUID()}`;
  localStorage.setItem(localClientIdKey, next);
  return next;
}

export function setLocalClientId(id: string) {
  localStorage.setItem(localClientIdKey, id);
}

export async function fetchProfile() {
  const body = await requestProfile<{ profile: PlayerProfile | null }>("/.netlify/functions/pips-profile?action=profile");
  if (body.profile) writeCachedProfile(body.profile);
  return body.profile;
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

export async function linkRemoteAccount(localId: string) {
  const body = await requestProfile<{ profile: PlayerProfile }>("/.netlify/functions/pips-profile?action=link-account", {
    method: "POST",
    body: JSON.stringify({ localId })
  });
  setLocalClientId(body.profile.id);
  writeCachedProfile(body.profile);
  return body.profile;
}

export async function fetchFriendsAndRecents() {
  return requestProfile<{ friends: PlayerSummary[]; recents: PlayerSummary[] }>("/.netlify/functions/pips-profile?action=friends");
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
  const session = readIdentitySession();
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  headers.set("x-pips-client-id", getLocalClientId());
  if (session?.access_token) headers.set("authorization", `Bearer ${session.access_token}`);
  const response = await fetch(url, { ...init, headers });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "Profile service is unavailable.");
  }
  return (await response.json()) as T;
}
