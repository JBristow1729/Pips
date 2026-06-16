# Pips

A browser-playable medieval tavern dice game with singleplayer, persistent local gold, and real multiplayer matchmaking through a lightweight authoritative WebSocket backend.

## Local Development

Install dependencies:

```bash
npm install
```

Run the frontend:

```bash
npm run dev
```

Run the multiplayer backend in a second terminal:

```bash
npm run dev:multiplayer
```

Open the Vite URL shown in the first terminal. Singleplayer works immediately. Multiplayer connects to `ws://localhost:1999` by default during development.

## Tests

```bash
npm test
```

The scoring rules are pure functions in `src/game/scoring.ts` and are covered by unit tests.

## Build And Netlify

```bash
npm run build
```

Netlify settings:

- Build command: `npm run build`
- Publish directory: `dist`

`netlify.toml` is included for SPA routing.

## Netlify Identity And Database Setup

This app keeps login optional. Singleplayer works with local storage only. Multiplayer asks the player to set a username, then stores that username, the hidden four digit friend hash, purse, friends, recents, and shop/customization inventory in Netlify Database. Creating a Netlify Identity account is optional and links the profile to the Identity UID for cross-platform play.

1. Enable Netlify Identity for the site:
   - In Netlify, open the site dashboard.
   - Go to **Project configuration > Identity**.
   - Enable Identity.
   - Under registration settings, allow email/password registration.
   - Enable email confirmation/verification so newly-created accounts must verify their email.
   - Keep external providers disabled unless you want to add them later.

2. Enable Netlify Database:
   - In the site dashboard, open **Database** and create/provision a database, or run:

```bash
netlify database init
```

   - The migration in `netlify/database/migrations/20260616010000_pips_identity.sql` creates:
     - `pips_profiles` for usernames, hashes, purse, account UID links, and customization inventory.
     - `pips_friendships` for directed friend relationships.
     - `pips_recent_players` for recently played users.

3. Apply migrations locally while using Netlify's local database:

```bash
netlify dev
netlify database migrations apply
```

Production and deploy-preview migrations are applied by Netlify during deploy when migration files live under `netlify/database/migrations`.

4. Function/API notes:
   - `netlify/functions/pips-profile.ts` uses `NETLIFY_DB_URL` from Netlify Database.
   - Authenticated requests send the Netlify Identity bearer token.
   - Unauthenticated username profiles use a local client id, so players can use multiplayer without creating an account.
   - Logging in later calls the profile link endpoint and associates the current profile with the Identity UID.

5. Password recovery:
   - The login dialog calls Netlify Identity's recovery endpoint.
   - Make sure Identity-generated recovery and confirmation emails are enabled and have valid site URLs.

6. Local development:
   - Use `netlify dev` when you need Identity, Functions, and Database together.
   - Use `npm run dev` for frontend-only singleplayer work.
   - Use `npm run dev:multiplayer` in a second terminal for the WebSocket lobby/game server.

## Multiplayer Deployment

Netlify hosts the frontend only. Real-time multiplayer uses the included WebSocket server as a companion backend because Netlify static hosting does not provide persistent authoritative WebSocket rooms.

Deploy the backend to any Node WebSocket host such as Render, Fly.io, Railway, or a small VPS:

```bash
npm install
npm run dev:multiplayer
```

Set this environment variable for the Netlify site:

```bash
VITE_MULTIPLAYER_URL=wss://your-backend-host.example
```

Then redeploy the Netlify frontend.

## Multiplayer Model

Players are matched by identical bet amount into server-side queues. Once two players with the same bet are available, the WebSocket server creates an authoritative room and manages turns, dice results, selected dice, hold and bank actions, busts, scores, winner detection, forfeits, and bet resolution events. Clients render state and send intent messages only. Clients never set dice results, scores, or gold directly.

## Scoring Summary

- `1` scores 100.
- `5` scores 50.
- Three to six of a kind scale by value, with `1`s treated as value 10.
- Low straight `1,2,3,4,5` scores 500.
- High straight `2,3,4,5,6` scores 750.
- Full straight `1,2,3,4,5,6` scores 1500.
- Scores are additive only when every selected die is part of a valid scoring combination.
