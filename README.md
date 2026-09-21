# Skip-Bo Multiplayer

A real-time multiplayer implementation of Skip-Bo. Node.js + Express serve
server-rendered EJS pages; Socket.IO drives live gameplay; storage persists
players, rooms, and game state so an active game survives a server restart.

Storage is pluggable: MySQL by default, or a zero-setup JSON-file dev mode
(see [Storage Modes](#storage-modes)) — same code path either way.

## Tech Stack

- **Backend:** Node.js, Express
- **Views:** EJS (server-rendered) + vanilla JS on the client
- **Real-time:** Socket.IO
- **Database:** MySQL via `mysql2` (connection pool, parameterized queries
  only) by default, or a local JSON file in dev mode — see below
- **Sessions:** `express-session`, backed by a MySQL store or a matching
  JSON-file store depending on `STORAGE`
- **Styling:** Tailwind CSS via CDN

## Project Structure

```
server.js            Express + Socket.IO bootstrap, restores active games on startup
routes/               Page routes (home, lobby, game, create/join)
sockets/              Socket.IO handlers + in-memory game manager
game/                 Pure rules engine (no Express/Socket.IO dependencies)
db/                   Storage layer: queries.js dispatches to mysqlQueries.js
                      or jsonQueries.js based on STORAGE; pool, session
                      stores (MySQL + JSON), room codes
views/                EJS templates (home, lobby, game, partials)
public/               Client JS/CSS
schema.sql            Full MySQL schema (only needed for STORAGE=mysql)
__tests__/            Jest unit tests for the rules engine
```

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create the database (skip this for JSON dev mode)

Make sure a MySQL (or MariaDB) server is running, then:

```bash
mysql -u root -p < schema.sql
```

This creates the `skipbo` database and all required tables (`players`,
`games`, `game_players`, `game_state`, `moves`, and the `sessions` table
used by the session store). Not needed if you're only running with
`STORAGE=json` — see [Storage Modes](#storage-modes).

### 3. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` with your database credentials and a session secret:

```
PORT=6767
STORAGE=mysql
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

Visit `http://localhost:6767` (or whatever `PORT` you set).

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
3. In the lobby, the host picks a stockpile size (3/5/7/10 cards — smaller
   than the official 30/20 for quicker games), an optional turn timer, and
   starts the game once at least 2 players (up to 6) have joined.
4. On the game page, drag a card (from your hand, your stockpile top, or
   one of your discard pile tops) onto a building pile or discard pile —
   or just tap the card, then tap the highlighted target. Legal targets
   highlight automatically. Discard piles show a peek of the card beneath
   the top one, though only the top card is ever playable. React with an
   emoji any time via the smiley button in your area.
5. First player to empty their stockpile wins. The host can then start a
   fresh game from the same lobby with **Play Again**.

## Storage Modes

Set `STORAGE` in `.env` to pick the backend. Both modes use the exact same
routes, sockets, and rules engine — only `db/queries.js`'s dispatch target
changes.

- **`STORAGE=mysql`** (default) — persists everything to MySQL via
  `db/mysqlQueries.js`, as described above. Requires `schema.sql` to be
  loaded and the `DB_*` variables configured.

- **`STORAGE=json`** — a zero-setup dev mode. No database server needed at
  all: players, rooms, game state, and moves are kept in a single local
  file (default `data/dev-db.json`, override with `JSON_DB_PATH`), and
  sessions are stored the same way instead of in a MySQL session table.
  Handy for quickly trying the app or working on gameplay/UI without
  standing up MySQL. Run it with:

  ```bash
  npm run dev:json
  ```

  (or set `STORAGE=json` in `.env` and use `npm run dev`/`npm start` as
  normal). `data/dev-db.json` is gitignored — delete it any time to reset
  to a clean slate. This mode is meant for local development, not
  production: writes are synchronous and the whole file is rewritten on
  every change.

  To go back to MySQL, set `STORAGE=mysql` (or just remove the line, since
  that's the default) and restart the server.

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
