# Tavern Dice

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
