const pool = require('./pool');

// -- players -----------------------------------------------------------

async function upsertPlayer(sessionId, displayName) {
  const [existing] = await pool.query(
    'SELECT id, display_name FROM players WHERE session_id = ?',
    [sessionId]
  );
  if (existing.length > 0) {
    if (existing[0].display_name !== displayName) {
      await pool.query('UPDATE players SET display_name = ? WHERE id = ?', [
        displayName,
        existing[0].id,
      ]);
    }
    return existing[0].id;
  }
  const [result] = await pool.query(
    'INSERT INTO players (display_name, session_id) VALUES (?, ?)',
    [displayName, sessionId]
  );
  return result.insertId;
}

async function getPlayerBySession(sessionId) {
  const [rows] = await pool.query(
    'SELECT id, display_name, session_id FROM players WHERE session_id = ?',
    [sessionId]
  );
  return rows[0] || null;
}

async function getPlayerById(playerId) {
  const [rows] = await pool.query(
    'SELECT id, display_name, session_id FROM players WHERE id = ?',
    [playerId]
  );
  return rows[0] || null;
}

// -- games ---------------------------------------------------------------

async function createGameRow(roomCode, hostPlayerId, maxPlayers) {
  const [result] = await pool.query(
    'INSERT INTO games (room_code, host_player_id, status, max_players) VALUES (?, ?, ?, ?)',
    [roomCode, hostPlayerId, 'lobby', maxPlayers]
  );
  return result.insertId;
}

async function getGameByRoomCode(roomCode) {
  const [rows] = await pool.query('SELECT * FROM games WHERE room_code = ?', [
    roomCode,
  ]);
  return rows[0] || null;
}

async function getGameById(gameId) {
  const [rows] = await pool.query('SELECT * FROM games WHERE id = ?', [
    gameId,
  ]);
  return rows[0] || null;
}

async function setGameStatus(gameId, status) {
  await pool.query('UPDATE games SET status = ? WHERE id = ?', [
    status,
    gameId,
  ]);
}

async function setGameTurn(gameId, seat) {
  await pool.query('UPDATE games SET current_turn_seat = ? WHERE id = ?', [
    seat,
    gameId,
  ]);
}

async function setGameWinner(gameId, playerId) {
  await pool.query(
    'UPDATE games SET winner_player_id = ?, status = ? WHERE id = ?',
    [playerId, 'finished', gameId]
  );
}

async function resetGameToLobby(gameId) {
  await pool.query(
    `UPDATE games
     SET status = 'lobby', current_turn_seat = NULL, winner_player_id = NULL
     WHERE id = ?`,
    [gameId]
  );
}

// -- game_players ----------------------------------------------------------

async function addPlayerToGame(gameId, playerId, seat) {
  await pool.query(
    `INSERT INTO game_players (game_id, player_id, seat, connected)
     VALUES (?, ?, ?, TRUE)
     ON DUPLICATE KEY UPDATE seat = VALUES(seat), connected = TRUE`,
    [gameId, playerId, seat]
  );
}

async function setPlayerConnected(gameId, playerId, connected) {
  await pool.query(
    'UPDATE game_players SET connected = ? WHERE game_id = ? AND player_id = ?',
    [connected, gameId, playerId]
  );
}

async function getGamePlayers(gameId) {
  const [rows] = await pool.query(
    `SELECT gp.player_id, gp.seat, gp.connected, p.display_name
     FROM game_players gp
     JOIN players p ON p.id = gp.player_id
     WHERE gp.game_id = ?
     ORDER BY gp.seat ASC`,
    [gameId]
  );
  return rows;
}

async function getSeatForPlayer(gameId, playerId) {
  const [rows] = await pool.query(
    'SELECT seat FROM game_players WHERE game_id = ? AND player_id = ?',
    [gameId, playerId]
  );
  return rows.length > 0 ? rows[0].seat : null;
}

// -- game_state ------------------------------------------------------------

async function saveGameState(gameId, stateJson) {
  await pool.query(
    `INSERT INTO game_state (game_id, state_json, version)
     VALUES (?, ?, 1)
     ON DUPLICATE KEY UPDATE state_json = VALUES(state_json), version = version + 1`,
    [gameId, JSON.stringify(stateJson)]
  );
}

async function loadGameState(gameId) {
  const [rows] = await pool.query(
    'SELECT state_json, version FROM game_state WHERE game_id = ?',
    [gameId]
  );
  if (rows.length === 0) return null;
  const raw = rows[0].state_json;
  return {
    state: typeof raw === 'string' ? JSON.parse(raw) : raw,
    version: rows[0].version,
  };
}

async function deleteGameState(gameId) {
  await pool.query('DELETE FROM game_state WHERE game_id = ?', [gameId]);
}

// -- moves -------------------------------------------------------------

async function recordMove(gameId, playerId, moveJson) {
  await pool.query(
    'INSERT INTO moves (game_id, player_id, move_json) VALUES (?, ?, ?)',
    [gameId, playerId, JSON.stringify(moveJson)]
  );
}

async function getRecentMoves(gameId, limit = 50) {
  const [rows] = await pool.query(
    'SELECT player_id, move_json, created_at FROM moves WHERE game_id = ? ORDER BY id DESC LIMIT ?',
    [gameId, limit]
  );
  return rows;
}

module.exports = {
  upsertPlayer,
  getPlayerBySession,
  getPlayerById,
  createGameRow,
  getGameByRoomCode,
  getGameById,
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
