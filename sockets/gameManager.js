const engine = require('../game');
const queries = require('../db/queries');

/**
 * Holds live game state in memory (the source of truth while the process
 * is running) and mirrors every change to MySQL so games survive a
 * restart. Keyed by numeric game id.
 */
const activeGames = new Map();

function getRoomEntry(gameId) {
  return activeGames.get(gameId) || null;
}

async function persist(gameId, state) {
  await queries.saveGameState(gameId, state);
  await queries.setGameTurn(gameId, state.currentTurnSeat ?? null);
  if (state.status === 'finished' && state.winnerSeat != null) {
    const entry = getRoomEntry(gameId);
    const winnerPlayerId = entry?.seatToPlayerId?.get(state.winnerSeat);
    if (winnerPlayerId) {
      await queries.setGameWinner(gameId, winnerPlayerId);
    }
  }
}

/**
 * Starts a new game for the given lobby. `seatedPlayers` is ordered by
 * seat and shaped [{ playerId, name }].
 */
async function startGame(gameId, seatedPlayers, options = {}) {
  const names = seatedPlayers.map((p) => p.name);
  const state = engine.createGame(names);

  const seatToPlayerId = new Map();
  seatedPlayers.forEach((p, seat) => seatToPlayerId.set(seat, p.playerId));

  const entry = {
    state,
    seatToPlayerId,
    turnTimerSeconds: options.turnTimerSeconds || null,
    turnTimeout: null,
  };
  activeGames.set(gameId, entry);

  await queries.setGameStatus(gameId, 'active');
  await persist(gameId, state);
  return entry;
}

/** Loads a persisted active game back into memory (server restart recovery). */
async function restoreGame(gameId) {
  const saved = await queries.loadGameState(gameId);
  if (!saved) return null;
  const players = await queries.getGamePlayers(gameId);
  const seatToPlayerId = new Map();
  players.forEach((p) => seatToPlayerId.set(p.seat, p.player_id));

  const entry = {
    state: saved.state,
    seatToPlayerId,
    turnTimerSeconds: null,
    turnTimeout: null,
  };
  activeGames.set(gameId, entry);
  return entry;
}

function getSeatForPlayerId(entry, playerId) {
  for (const [seat, pid] of entry.seatToPlayerId.entries()) {
    if (pid === playerId) return seat;
  }
  return null;
}

async function applyPlayerMove(gameId, playerId, move) {
  const entry = getRoomEntry(gameId);
  if (!entry) return { ok: false, error: 'Game is not active' };

  const seat = getSeatForPlayerId(entry, playerId);
  if (seat === null) return { ok: false, error: 'You are not seated in this game' };

  const result = engine.applyMove(entry.state, seat, move);
  if (!result.ok) return result;

  await queries.recordMove(gameId, playerId, move);
  await persist(gameId, entry.state);
  return { ...result, seat };
}

function setConnected(gameId, playerId, connected) {
  const entry = getRoomEntry(gameId);
  if (!entry) return;
  const seat = getSeatForPlayerId(entry, playerId);
  if (seat === null) return;
  const player = entry.state.players.find((p) => p.seat === seat);
  if (player) player.connected = connected;
}

function removeGame(gameId) {
  const entry = getRoomEntry(gameId);
  if (entry?.turnTimeout) clearTimeout(entry.turnTimeout);
  activeGames.delete(gameId);
}

module.exports = {
  activeGames,
  getRoomEntry,
  startGame,
  restoreGame,
  persist,
  getSeatForPlayerId,
  applyPlayerMove,
  setConnected,
  removeGame,
};
