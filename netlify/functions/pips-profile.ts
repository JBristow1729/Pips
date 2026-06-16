import type { Handler, HandlerEvent } from "@netlify/functions";
import { Pool } from "pg";

type DiceCustomizationInventory = {
  equipped: unknown;
  owned: unknown;
};

type Profile = {
  id: string;
  identityId: string | null;
  username: string;
  hash: string;
  gold: number;
  customization: DiceCustomizationInventory | null;
};

let pool: Pool | null = null;

const usernameMaxLength = 12;

const handler: Handler = async (event, context) => {
  if (event.httpMethod === "OPTIONS") return json({});
  try {
    const user = context.clientContext?.user;
    const clientId = event.headers["x-pips-client-id"] ?? event.headers["X-Pips-Client-Id"];
    const actorId = user?.sub ?? clientId;
    const action = event.queryStringParameters?.action ?? "profile";

    if (!actorId) return json({ error: "A local client id or Netlify Identity session is required." }, 401);

    if (event.httpMethod === "GET" && action === "profile") {
      const profile = await getProfileByActor(actorId, user?.sub ?? null);
      return json({ profile });
    }

    if (event.httpMethod === "POST" && action === "username") {
      const body = parseBody<{ username?: string; gold?: number; customization?: DiceCustomizationInventory }>(event);
      const username = cleanUsername(body.username ?? "");
      if (!username) return json({ error: "Username is required." }, 400);
      const profile = await assignUsername(actorId, user?.sub ?? null, username, body.gold, body.customization ?? null);
      return json({ profile });
    }

    if (event.httpMethod === "PATCH" && action === "profile") {
      const body = parseBody<{ gold?: number; customization?: DiceCustomizationInventory }>(event);
      const profile = await updateProfile(actorId, user?.sub ?? null, body.gold, body.customization);
      return json({ profile });
    }

    if (event.httpMethod === "POST" && action === "link-account") {
      if (!user?.sub) return json({ error: "Log in before linking this profile." }, 401);
      const body = parseBody<{ localId?: string }>(event);
      const profile = await linkAccount(user.sub, body.localId ?? actorId);
      return json({ profile });
    }

    if (event.httpMethod === "GET" && action === "friends") {
      const profile = await requireProfile(actorId, user?.sub ?? null);
      const friends = await listFriends(profile.id);
      const recents = await listRecents(profile.id);
      return json({ friends, recents });
    }

    if (event.httpMethod === "GET" && action === "search") {
      const profile = await requireProfile(actorId, user?.sub ?? null);
      const query = event.queryStringParameters?.q ?? "";
      const results = await searchProfiles(profile.id, query);
      return json({ results });
    }

    if (event.httpMethod === "POST" && action === "friend") {
      const profile = await requireProfile(actorId, user?.sub ?? null);
      const body = parseBody<{ friendId?: string }>(event);
      if (!body.friendId) return json({ error: "Friend id is required." }, 400);
      await addFriend(profile.id, body.friendId);
      return json({ ok: true });
    }

    if (event.httpMethod === "DELETE" && action === "friend") {
      const profile = await requireProfile(actorId, user?.sub ?? null);
      const body = parseBody<{ friendId?: string }>(event);
      if (!body.friendId) return json({ error: "Friend id is required." }, 400);
      await removeFriend(profile.id, body.friendId);
      return json({ ok: true });
    }

    if (event.httpMethod === "POST" && action === "recent") {
      const profile = await requireProfile(actorId, user?.sub ?? null);
      const body = parseBody<{ otherId?: string }>(event);
      if (!body.otherId) return json({ error: "Recent player id is required." }, 400);
      await addRecent(profile.id, body.otherId);
      return json({ ok: true });
    }

    return json({ error: "Not found." }, 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected profile service error.";
    return json({ error: message }, 500);
  }
};

export { handler };

function getPool() {
  if (!pool) {
    const connectionString = process.env.NETLIFY_DB_URL ?? process.env.DATABASE_URL;
    if (!connectionString) throw new Error("NETLIFY_DB_URL is not configured.");
    pool = new Pool({ connectionString });
  }
  return pool;
}

async function getProfileByActor(actorId: string, identityId: string | null): Promise<Profile | null> {
  const db = getPool();
  const { rows } = await db.query("SELECT * FROM pips_profiles WHERE id = $1 OR identity_id = $2 LIMIT 1", [actorId, identityId]);
  return rows[0] ? toProfile(rows[0]) : null;
}

async function requireProfile(actorId: string, identityId: string | null): Promise<Profile> {
  const profile = await getProfileByActor(actorId, identityId);
  if (!profile) throw new Error("Set a username first.");
  return profile;
}

async function assignUsername(actorId: string, identityId: string | null, username: string, gold?: number, customization?: DiceCustomizationInventory | null): Promise<Profile> {
  const db = getPool();
  const search = normalizeUsername(username);
  const hash = await firstAvailableHash(search, actorId);
  if (!hash) throw new Error("That username is fully taken. Please choose another.");
  const existing = await getProfileByActor(actorId, identityId);
  const profileId = existing?.id ?? actorId;
  const { rows } = await db.query(
    `INSERT INTO pips_profiles (id, identity_id, username, username_search, friend_hash, gold, customization)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (id) DO UPDATE
       SET identity_id = COALESCE(EXCLUDED.identity_id, pips_profiles.identity_id),
           username = EXCLUDED.username,
           username_search = EXCLUDED.username_search,
           friend_hash = EXCLUDED.friend_hash,
           gold = GREATEST(pips_profiles.gold, EXCLUDED.gold),
           customization = COALESCE(EXCLUDED.customization, pips_profiles.customization),
           updated_at = NOW()
     RETURNING *`,
    [profileId, identityId, username, search, hash, clampGold(gold), customization ? JSON.stringify(customization) : null]
  );
  return toProfile(rows[0]);
}

async function firstAvailableHash(usernameSearch: string, actorId: string) {
  const db = getPool();
  const { rows } = await db.query("SELECT friend_hash FROM pips_profiles WHERE username_search = $1 AND id <> $2", [usernameSearch, actorId]);
  const used = new Set(rows.map((row) => row.friend_hash as string));
  const start = Math.floor(Math.random() * 10000);
  for (let offset = 0; offset < 10000; offset += 1) {
    const candidate = String((start + offset) % 10000).padStart(4, "0");
    if (!used.has(candidate)) return candidate;
  }
  return "";
}

async function updateProfile(actorId: string, identityId: string | null, gold?: number, customization?: DiceCustomizationInventory): Promise<Profile> {
  const profile = await requireProfile(actorId, identityId);
  const db = getPool();
  const { rows } = await db.query(
    `UPDATE pips_profiles
     SET gold = COALESCE($2, gold),
         customization = COALESCE($3, customization),
         identity_id = COALESCE($4, identity_id),
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [profile.id, typeof gold === "number" ? clampGold(gold) : null, customization ? JSON.stringify(customization) : null, identityId]
  );
  return toProfile(rows[0]);
}

async function linkAccount(identityId: string, localId: string): Promise<Profile> {
  const db = getPool();
  const existingAccount = await getProfileByActor(identityId, identityId);
  if (existingAccount) return existingAccount;
  const { rows } = await db.query(
    "UPDATE pips_profiles SET id = $1, identity_id = $1, updated_at = NOW() WHERE id = $2 RETURNING *",
    [identityId, localId]
  );
  if (rows[0]) return toProfile(rows[0]);
  throw new Error("No local profile exists to link.");
}

async function listFriends(profileId: string) {
  const db = getPool();
  const { rows } = await db.query(
    `SELECT p.id, p.username, p.friend_hash AS hash
     FROM pips_friendships f
     JOIN pips_profiles p ON p.id = f.friend_id
     WHERE f.user_id = $1
     ORDER BY LOWER(p.username)`,
    [profileId]
  );
  return rows;
}

async function listRecents(profileId: string) {
  const db = getPool();
  const { rows } = await db.query(
    `SELECT p.id, p.username, p.friend_hash AS hash
     FROM pips_recent_players r
     JOIN pips_profiles p ON p.id = r.other_id
     WHERE r.user_id = $1
     ORDER BY r.last_played_at DESC
     LIMIT 25`,
    [profileId]
  );
  return rows;
}

async function searchProfiles(profileId: string, query: string) {
  const db = getPool();
  const parsed = parseSearch(query);
  if (!parsed.name) return [];
  const { rows } = await db.query(
    `SELECT p.id, p.username, p.friend_hash AS hash, f.friend_id IS NOT NULL AS friend,
            CASE
              WHEN p.username_search = $2 THEN 0
              WHEN p.username_search LIKE $2 || '%' THEN 1
              ELSE 2
            END AS rank
     FROM pips_profiles p
     LEFT JOIN pips_friendships f ON f.user_id = $1 AND f.friend_id = p.id
     WHERE p.id <> $1
       AND p.username_search LIKE '%' || $2 || '%'
       AND ($3 = '' OR p.friend_hash LIKE $3 || '%')
     ORDER BY friend DESC, rank ASC, p.username_search ASC
     LIMIT 20`,
    [profileId, normalizeUsername(parsed.name), parsed.hash]
  );
  return rows;
}

async function addFriend(profileId: string, friendId: string) {
  const db = getPool();
  await db.query("INSERT INTO pips_friendships (user_id, friend_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [profileId, friendId]);
}

async function removeFriend(profileId: string, friendId: string) {
  const db = getPool();
  await db.query("DELETE FROM pips_friendships WHERE user_id = $1 AND friend_id = $2", [profileId, friendId]);
}

async function addRecent(profileId: string, otherId: string) {
  const db = getPool();
  await db.query(
    `INSERT INTO pips_recent_players (user_id, other_id, last_played_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (user_id, other_id) DO UPDATE SET last_played_at = NOW()`,
    [profileId, otherId]
  );
}

function cleanUsername(username: string) {
  const value = username.trim().replace(/\s+/g, " ");
  if (value.length > usernameMaxLength) throw new Error(`Username must be ${usernameMaxLength} characters or fewer.`);
  if (!/^[A-Za-z ]+$/.test(value)) throw new Error("Use letters and spaces only.");
  return value;
}

function normalizeUsername(username: string) {
  return username.toLowerCase().replace(/\s+/g, " ").trim();
}

function parseSearch(query: string) {
  const [namePart, hashPart = ""] = query.split("#");
  return {
    name: namePart.trim(),
    hash: hashPart.replace(/\D/g, "").slice(0, 4)
  };
}

function clampGold(gold: unknown) {
  return typeof gold === "number" && Number.isFinite(gold) ? Math.max(0, Math.floor(gold)) : 100;
}

function parseBody<T>(event: HandlerEvent): T {
  if (!event.body) return {} as T;
  return JSON.parse(event.body) as T;
}

function toProfile(row: Record<string, unknown>): Profile {
  return {
    id: String(row.id),
    identityId: row.identity_id ? String(row.identity_id) : null,
    username: String(row.username),
    hash: String(row.friend_hash),
    gold: Number(row.gold),
    customization: (row.customization as DiceCustomizationInventory | null) ?? null
  };
}

function json(body: unknown, statusCode = 200) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store"
    },
    body: JSON.stringify(body)
  };
}
