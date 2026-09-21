# Skip-Bo Multiplayer

A real-time multiplayer implementation of Skip-Bo. Node.js + Express serve
server-rendered EJS pages; Socket.IO drives live gameplay; MySQL persists
players, rooms, and game state so an active game survives a server restart.

## Tech Stack

- **Backend:** Node.js, Express
- **Views:** EJS (server-rendered) + vanilla JS on the client
- **Real-time:** Socket.IO
- **Database:** MySQL via `mysql2` (connection pool, parameterized queries only)
- **Sessions:** `express-session` backed by a MySQL session store
- **Styling:** Tailwind CSS via CDN

## Project Structure

```
server.js            Express + Socket.IO bootstrap, restores active games on startup
routes/               Page routes (home, lobby, game, create/join)
sockets/              Socket.IO handlers + in-memory game manager
game/                 Pure rules engine (no Express/Socket.IO dependencies)
db/                   MySQL pool, parameterized queries, session store, room codes
views/                EJS templates (home, lobby, game, partials)
public/               Client JS/CSS
schema.sql            Full MySQL schema
__tests__/            Jest unit tests for the rules engine
```

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create the database

Make sure a MySQL (or MariaDB) server is running, then:

```bash
mysql -u root -p < schema.sql
```

This creates the `skipbo` database and all required tables (`players`,
`games`, `game_players`, `game_state`, `moves`, and the `sessions` table
used by the session store).

### 3. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` with your database credentials and a session secret:

```
PORT=3000
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your-password
DB_NAME=skipbo
SESSION_SECRET=some-long-random-string
```

### 4. Run the server

```bash
npm start
```

Or with auto-reload during development:

```bash
npm run dev
```

Visit `http://localhost:3000`.

### 5. Run the tests

```bash
npm test
```

Covers the rules engine: deck composition, deal sizes by player count,
building pile start rules, Skip-Bo wild placement, completed pile removal
and reshuffle, mid-turn hand refill, discard rules, stockpile-to-discard
rejection, and win detection.

## How to Play

1. Enter a display name on the home page.
2. **Create Game** to get a 5-character room code, or **Join Game** with a
   code a friend shared.
3. In the lobby, the host can set an optional turn timer and starts the
   game once at least 2 players (up to 6) have joined.
4. On the game page, click a card to select it (from your hand, your
   stockpile top, or one of your discard pile tops), then click a
   highlighted building pile to play it, or a discard pile to end your
   turn. Legal targets highlight automatically.
5. First player to empty their stockpile wins. The host can then start a
   fresh game from the same lobby with **Play Again**.

## Server Authority

All rules are enforced server-side in `game/rules.js`. The client only ever
sends `{ type, source, sourceIndex, targetPileIndex }`; the server
re-validates every move against the full game state before applying it.
Each socket only ever receives its own hand plus public information about
everyone else (stockpile tops/counts, discard tops, building piles, draw
pile count, whose turn it is) — see `game/index.js#getPublicState`.

Shuffling uses `crypto.randomInt` (Fisher-Yates), never `Math.random`.

## Persistence Model

The authoritative game state lives in memory (`sockets/gameManager.js`)
while the server is running, for fast move validation. After every move,
the full state is serialized to the `game_state` table (versioned) and the
move itself is appended to `moves`. On startup, `server.js` reloads any
game still marked `active` in the `games` table back into memory, so a
server restart doesn't lose in-progress games.
