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

## Wholegrain Accounts And Database Setup

This app does not own Netlify Identity. Pips keeps local-first profiles and game-specific data, while the separate Wholegrain Studios Netlify project owns account creation, login, email confirmation, and password recovery. Pips links a profile to a central Wholegrain Identity UID only when the Wholegrain Accounts service calls its protected link endpoint.

1. In the Wholegrain Studios Netlify project, enable Netlify Identity:
   - Go to **Project configuration > Identity**.
   - Enable Identity.
   - Allow email/password registration.
   - Enable confirmation emails and password recovery emails.
   - Set email template URLs to the Wholegrain Studios account pages, not the Pips app.

2. In the Pips Netlify project, keep Netlify Identity disabled unless another feature explicitly needs it.

3. Point Pips at the central account-link page:
   - Set this environment variable on the Pips Netlify project:

```bash
VITE_WHOLEGRAIN_ACCOUNTS_URL=https://wholegrainstudios.co.uk/accounts/link
```

   - The Pips app redirects players there with:
     - `game=pips`
     - `gameAccountId=<the local Pips profile id>`
     - `returnTo=<the current Pips URL>`

4. Add the same secret to both Netlify projects:

```bash
WHOLEGRAIN_LINK_SECRET=<long random secret>
```

   - Store it on the Pips project so `netlify/functions/pips-profile.ts` can verify central link requests.
   - Store it on the Wholegrain Studios project so the Accounts service can call Pips.
   - Never expose this value to browser code or a `VITE_` variable.

5. From the Wholegrain Accounts service, after the user is logged in and confirms the link, call the Pips function:

```http
POST https://pips.wholegrainstudios.co.uk/.netlify/functions/pips-profile?action=link-wholegrain-account
content-type: application/json
x-wholegrain-link-secret: <WHOLEGRAIN_LINK_SECRET>

{
  "identityId": "<central Netlify Identity user.sub>",
  "gameAccountId": "<Pips profile id from the link URL>"
}
```

   - On success, redirect the player back to `returnTo`.
   - For production, replace the raw `gameAccountId` URL handoff with a short-lived signed link token minted by Pips.

6. Enable Netlify Database for Pips:
   - In the site dashboard, open **Database** and create/provision a database, or run:

```bash
netlify database init
```

   - The migration in `netlify/database/migrations/20260616010000_pips_identity.sql` creates:
     - `pips_profiles` for usernames, hashes, purse, account UID links, and customization inventory.
     - `pips_friendships` for directed friend relationships.
     - `pips_recent_players` for recently played users.

7. Apply migrations locally while using Netlify's local database:

```bash
netlify dev
netlify database migrations apply
```

Production and deploy-preview migrations are applied by Netlify during deploy when migration files live under `netlify/database/migrations`.

8. Function/API notes:
   - `netlify/functions/pips-profile.ts` uses `NETLIFY_DB_URL` from Netlify Database.
   - Browser requests identify the player with a local Pips client/profile id.
   - The central Wholegrain Accounts service links `identity_id` through the protected `link-wholegrain-account` action.
   - Pips account dialogs only redirect to Wholegrain Accounts; they do not collect email or password.

9. Local development:
   - Use `netlify dev` when you need Functions and Database together.
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
