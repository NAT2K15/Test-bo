// Drop-in replacement for mysqlQueries.js backed by a local JSON file
// instead of MySQL. Used when STORAGE=json (see queries.js). Mirrors the
// same function names, arguments, and return shapes.
const { data, persist, nextId } = require('./jsonStore');

// -- players -----------------------------------------------------------

async function upsertPlayer(sessionId, displayName) {
  const existing = data.players.find((p) => p.session_id === sessionId);
  if (existing) {
    if (existing.display_name !== displayName) {
      existing.display_name = displayName;
      persist();
    }
    return existing.id;
  }
  const id = nextId('players');
  data.players.push({
    id,
    display_name: displayName,
    session_id: sessionId,
    created_at: new Date(),
  });
  persist();
  return id;
}

async function getPlayerBySession(sessionId) {
  return data.players.find((p) => p.session_id === sessionId) || null;
}

async function getPlayerById(playerId) {
  return data.players.find((p) => p.id === playerId) || null;
}

// -- games ---------------------------------------------------------------

async function createGameRow(roomCode, hostPlayerId, maxPlayers) {
  const id = nextId('games');
  data.games.push({
    id,
    room_code: roomCode,
    host_player_id: hostPlayerId,
    status: 'lobby',
    max_players: maxPlayers,
    current_turn_seat: null,
    winner_player_id: null,
    turn_timer_seconds: null,
    created_at: new Date(),
  });
  persist();
  return id;
}

async function getGameByRoomCode(roomCode) {
  return data.games.find((g) => g.room_code === roomCode) || null;
}

async function getGameById(gameId) {
  return data.games.find((g) => g.id === gameId) || null;
}

async function getActiveGameIds() {
  return data.games.filter((g) => g.status === 'active').map((g) => g.id);
}

function requireGame(gameId) {
  const game = data.games.find((g) => g.id === gameId);
  if (!game) throw new Error(`No game with id ${gameId}`);
  return game;
}

async function setGameStatus(gameId, status) {
  requireGame(gameId).status = status;
  persist();
}

async function setGameTurn(gameId, seat) {
  requireGame(gameId).current_turn_seat = seat;
  persist();
}

async function setGameWinner(gameId, playerId) {
  const game = requireGame(gameId);
  game.winner_player_id = playerId;
  game.status = 'finished';
  persist();
}

async function resetGameToLobby(gameId) {
  const game = requireGame(gameId);
  game.status = 'lobby';
  game.current_turn_seat = null;
  game.winner_player_id = null;
  persist();
}

// -- game_players ----------------------------------------------------------

async function addPlayerToGame(gameId, playerId, seat) {
  const existing = data.gamePlayers.find(
    (gp) => gp.game_id === gameId && gp.player_id === playerId
  );
  if (existing) {
    existing.seat = seat;
    existing.connected = true;
  } else {
    data.gamePlayers.push({
      game_id: gameId,
      player_id: playerId,
      seat,
      connected: true,
      joined_at: new Date(),
    });
  }
  persist();
}

async function setPlayerConnected(gameId, playerId, connected) {
  const gp = data.gamePlayers.find(
    (row) => row.game_id === gameId && row.player_id === playerId
  );
  if (gp) {
    gp.connected = connected;
    persist();
  }
}

async function getGamePlayers(gameId) {
  return data.gamePlayers
    .filter((gp) => gp.game_id === gameId)
    .map((gp) => {
      const player = data.players.find((p) => p.id === gp.player_id);
      return {
        player_id: gp.player_id,
        seat: gp.seat,
        connected: gp.connected,
        display_name: player ? player.display_name : null,
      };
    })
    .sort((a, b) => a.seat - b.seat);
}

async function getSeatForPlayer(gameId, playerId) {
  const gp = data.gamePlayers.find(
    (row) => row.game_id === gameId && row.player_id === playerId
  );
  return gp ? gp.seat : null;
}

// -- game_state ------------------------------------------------------------

async function saveGameState(gameId, stateJson) {
  const prev = data.gameStates[gameId];
  data.gameStates[gameId] = {
    state_json: stateJson,
    version: prev ? prev.version + 1 : 1,
    updated_at: new Date(),
  };
  persist();
}

async function loadGameState(gameId) {
  const row = data.gameStates[gameId];
  if (!row) return null;
  return { state: row.state_json, version: row.version };
}

async function deleteGameState(gameId) {
  delete data.gameStates[gameId];
  persist();
}

// -- moves -------------------------------------------------------------

async function recordMove(gameId, playerId, moveJson) {
  const id = nextId('moves');
  data.moves.push({
    id,
    game_id: gameId,
    player_id: playerId,
    move_json: moveJson,
    created_at: new Date(),
  });
  persist();
}

async function getRecentMoves(gameId, limit = 50) {
  return data.moves
    .filter((m) => m.game_id === gameId)
    .sort((a, b) => b.id - a.id)
    .slice(0, limit)
    .map((m) => ({
      player_id: m.player_id,
      move_json: m.move_json,
      created_at: m.created_at,
    }));
}

module.exports = {
  upsertPlayer,
  getPlayerBySession,
  getPlayerById,
  createGameRow,
  getGameByRoomCode,
  getGameById,
  getActiveGameIds,
  setGameStatus,
  setGameTurn,
  setGameWinner,
  resetGameToLobby,
  addPlayerToGame,
  setPlayerConnected,
  getGamePlayers,
  getSeatForPlayer,
  saveGameState,
  loadGameState,
  deleteGameState,
  recordMove,
  getRecentMoves,
};
