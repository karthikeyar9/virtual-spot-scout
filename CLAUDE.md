# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Frontend (root)
```bash
npm run dev        # Start frontend dev server on port 8080
npm run build      # Production build
npm run lint       # ESLint
npm run test       # Vitest in watch mode
npm run test:run   # Vitest single run (CI)
npx vitest run src/components/GameLobby.test.tsx  # Run a single test file
```

### Backend
```bash
cd backend
npm run dev        # nodemon server.js, runs on port 3001
npm start          # node server.js (production)
```

Both servers must run simultaneously in development. The frontend connects to `http://localhost:3001` by default; override with `VITE_SOCKET_SERVER_URL`.

## Architecture

This is a **multiplayer browser game platform** with two independent deployments:

- **Frontend**: React + Vite + TypeScript, deployed to Vercel
- **Backend**: Node.js + Express + Socket.IO, deployed to Render (`https://virtual-city-guess-backend.onrender.com`)

### Game Registry Pattern

Games are registered in two mirrored registries — one on each side:

- **`src/games/registry.ts`** — maps game IDs to `GameDefinition` objects (UI metadata + lazy-loaded React component + config fields)
- **`backend/games/registry.js`** — maps game IDs to handler modules with `onStart()` and `registerEvents()` callbacks

To add a new game, create a component directory under `src/games/<id>/` implementing `GameComponentProps` (from `src/games/types.ts`), add a handler at `backend/games/<id>.js`, and register both in their respective registries.

### Routing

```
/                          → Home (game selection)
/game/:gameType/create     → CreateGamePage (config + room creation)
/game/:gameType/:roomId    → GamePage (lobby + active game)
/join/:roomId              → JoinRedirect (infers gameType then redirects)
```

`GamePage` URL params carry state: `?name=`, `?host=true`, `?playerId=`, `?rounds=`, `?time=`.

### Real-time State Flow

1. **`SocketContext`** (`src/contexts/SocketContext.tsx`) — creates and manages the Socket.IO connection; exposes `{ socket, isConnected, error }` via `useSocket()`.
2. **`useLobby`** (`src/hooks/useLobby.ts`) — handles pre-game room state: joining, ready toggling, and listening for `roomState` / `playersUpdated` / `gameStarted` events. Guards against double-joins with `hasJoinedRef`.
3. **`GamePage`** — orchestrates the lobby vs. active game view; passes `GameComponentProps` to the lazy-loaded game component once `hasStarted` is true.
4. **Game components** (e.g., `CityGuesserGame`, `TriviaGame`) manage their own in-game socket events independently.

Player identity is persisted in `localStorage` (`playerInfo` key) so players can rejoin after a page refresh without losing their score.

### Backend Room Model

All room state lives in an in-memory `rooms` object keyed by `roomId`. The server handles shared events (`joinRoom`, `playerReady`, `startGame`, `nextRound`, `getRoomState`) and delegates game-specific events to each handler's `registerEvents()`. During an active game, disconnected players are marked and given 60 seconds to reconnect before removal.

### Scoring (City Guesser)

Distance-based scoring is implemented client-side in `src/hooks/useGameState.ts`. The score tiers range from 5000 pts (<1 km) down to 0 pts (>10,000 km). `useGameState` is a legacy local-only hook; multiplayer scoring is server-authoritative via `useLobby` + socket events.

### UI Components

shadcn/ui components live in `src/components/ui/`. Custom game components (`GameLobby`, `GameRoom`, `Navbar`, etc.) are in `src/components/`. Path alias `@/` maps to `src/`.
