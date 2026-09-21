// Minimal file-backed store used by STORAGE=json dev mode, so the app can
// run without a MySQL server. Not for production use: writes are
// synchronous and the whole file is rewritten on every change.
const fs = require('fs');
const path = require('path');

const DATA_FILE =
  process.env.JSON_DB_PATH || path.join(__dirname, '..', 'data', 'dev-db.json');

function emptyData() {
  return {
    nextIds: { players: 1, games: 1, moves: 1 },
    players: [],
    games: [],
    gamePlayers: [],
    gameStates: {},
    moves: [],
    sessions: {},
  };
}

function load() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return { ...emptyData(), ...JSON.parse(raw) };
  } catch {
    return emptyData();
  }
}

const data = load();

function persist() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function nextId(kind) {
  const id = data.nextIds[kind]++;
  persist();
  return id;
}

module.exports = { data, persist, nextId, DATA_FILE };
