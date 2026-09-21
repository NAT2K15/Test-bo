const crypto = require('crypto');
const queries = require('../db/queries');
const engine = require('../game');
const gameManager = require('./gameManager');

const TURN_TIMER_MIN = 10;
const TURN_TIMER_MAX = 120;
const ALLOWED_STOCKPILE_SIZES = [3, 5, 7, 10];
const ALLOWED_REACTIONS = ['😀', '😘', '😢', '😲', '😜', '😳'];

function lobbyRoom(gameId) {
  return `lobby:${gameId}`;
}
function gameRoom(gameId) {
  return `game:${gameId}`;
}

async function broadcastLobby(io, game) {
  const players = await queries.getGamePlayers(game.id);
  io.to(lobbyRoom(game.id)).emit('lobby:state', {
    roomCode: game.room_code,
    maxPlayers: game.max_players,
    hostPlayerId: game.host_player_id,
    players: players.map((p) => ({
      playerId: p.player_id,
      seat: p.seat,
      name: p.display_name,
      connected: !!p.connected,
    })),
  });
}

async function broadcastGameState(io, gameId) {
  const entry = gameManager.getRoomEntry(gameId);
  if (!entry) return;
  const sockets = await io.in(gameRoom(gameId)).fetchSockets();
  for (const socket of sockets) {
    if (socket.data.seat == null) continue;
    socket.emit('game:state', engine.getPublicState(entry.state, socket.data.seat));
  }
}

function currentPlayerId(entry) {
  return entry.seatToPlayerId.get(entry.state.currentTurnSeat);
}

function clearTurnTimer(entry) {
  if (entry.turnTimeout) {
    clearTimeout(entry.turnTimeout);
    entry.turnTimeout = null;
  }
}

/** (Re)schedules the auto-discard timeout for whoever's turn it currently is. */
function scheduleTurnTimer(io, gameId, roomCode) {
  const entry = gameManager.getRoomEntry(gameId);
  if (!entry) return;
  clearTurnTimer(entry);

  if (!entry.turnTimerSeconds || entry.state.status !== 'active') return;

  entry.turnTimeout = setTimeout(async () => {
    await autoDiscard(io, gameId, roomCode);
  }, entry.turnTimerSeconds * 1000);
}

/** Turn ran out of time: discard a random hand card on the player's behalf. */
async function autoDiscard(io, gameId, roomCode) {
  const entry = gameManager.getRoomEntry(gameId);
  if (!entry || entry.state.status !== 'active') return;

  const seat = entry.state.currentTurnSeat;
  const player = entry.state.players.find((p) => p.seat === seat);
  if (!player || player.hand.length === 0) return;

  const move = {
    type: 'DISCARD',
    sourceIndex: crypto.randomInt(player.hand.length),
    targetPileIndex: crypto.randomInt(player.discardPiles.length),
  };
  const playerId = currentPlayerId(entry);
  const result = await gameManager.applyPlayerMove(gameId, playerId, move);
  if (result.ok) {
    entry.state.log.push({ type: 'AUTO_DISCARD', seat });
    await broadcastGameState(io, gameId);
    scheduleTurnTimer(io, gameId, roomCode);
  }
}

function registerSocketHandlers(io) {
  io.on('connection', (socket) => {
    const session = socket.request.session;

    socket.on('lobby:join', async (roomCode) => {
      try {
        if (!session?.playerId) return;
        const game = await queries.getGameByRoomCode(String(roomCode).toUpperCase());
        if (!game) return;
        socket.join(lobbyRoom(game.id));
        socket.data.gameId = game.id;
        await broadcastLobby(io, game);
      } catch (err) {
        socket.emit('error:toast', 'Could not join lobby');
      }
    });

    socket.on('lobby:start', async ({ roomCode, turnTimerSeconds, stockpileSize } = {}) => {
      try {
        if (!session?.playerId) return;
        const game = await queries.getGameByRoomCode(String(roomCode).toUpperCase());
        if (!game) return;
        if (game.host_player_id !== session.playerId) {
          return socket.emit('error:toast', 'Only the host can start the game');
        }
        if (game.status !== 'lobby') return;

        const players = await queries.getGamePlayers(game.id);
        if (players.length < 2) {
          return socket.emit('error:toast', 'Need at least 2 players to start');
        }

        const seatedPlayers = players
          .slice()
          .sort((a, b) => a.seat - b.seat)
          .map((p) => ({ playerId: p.player_id, name: p.display_name }));

        const timer = Number(turnTimerSeconds);
        const validTimer =
          Number.isFinite(timer) && timer >= TURN_TIMER_MIN && timer <= TURN_TIMER_MAX
            ? timer
            : null;

        const size = Number(stockpileSize);
        const validStockpileSize = ALLOWED_STOCKPILE_SIZES.includes(size) ? size : null;

        await gameManager.startGame(game.id, seatedPlayers, {
          turnTimerSeconds: validTimer,
          stockpileSize: validStockpileSize,
        });
        io.to(lobbyRoom(game.id)).emit('lobby:started', { roomCode: game.room_code });
        scheduleTurnTimer(io, game.id, game.room_code);
      } catch (err) {
        socket.emit('error:toast', 'Could not start game');
      }
    });

    socket.on('game:join', async (roomCode) => {
      try {
        if (!session?.playerId) return;
        const game = await queries.getGameByRoomCode(String(roomCode).toUpperCase());
        if (!game) return;

        let entry = gameManager.getRoomEntry(game.id);
        if (!entry) {
          entry = await gameManager.restoreGame(game.id);
        }
        if (!entry) return;

        const seat = gameManager.getSeatForPlayerId(entry, session.playerId);
        if (seat === null) return;

        socket.join(gameRoom(game.id));
        socket.data.gameId = game.id;
        socket.data.seat = seat;
        socket.data.playerId = session.playerId;

        gameManager.setConnected(game.id, session.playerId, true);
        await queries.setPlayerConnected(game.id, session.playerId, true);

        socket.emit('game:state', engine.getPublicState(entry.state, seat));
        await broadcastGameState(io, game.id);
      } catch (err) {
        socket.emit('error:toast', 'Could not join game');
      }
    });

    socket.on('game:move', async (move) => {
      try {
        const { gameId, playerId } = socket.data;
        if (!gameId || !playerId) return;
        const entry = gameManager.getRoomEntry(gameId);
        if (!entry) return;
        const game = await queries.getGameById(gameId);

        const result = await gameManager.applyPlayerMove(gameId, playerId, move);
        if (!result.ok) {
          return socket.emit('error:toast', result.error || 'Illegal move');
        }

        await broadcastGameState(io, gameId);

        if (result.endedTurn) {
          scheduleTurnTimer(io, gameId, game.room_code);
        }
        if (result.gameOver) {
          clearTurnTimer(entry);
        }
      } catch (err) {
        socket.emit('error:toast', 'Could not apply move');
      }
    });

    socket.on('game:reaction', (emoji) => {
      const { gameId, seat } = socket.data;
      if (!gameId || seat == null) return;
      if (!ALLOWED_REACTIONS.includes(emoji)) return;
      io.to(gameRoom(gameId)).emit('game:reaction', { seat, emoji });
    });

    socket.on('game:playAgain', async () => {
      try {
        const { gameId } = socket.data;
        if (!gameId) return;
        const game = await queries.getGameById(gameId);
        if (!game || game.host_player_id !== session?.playerId) return;

        gameManager.removeGame(gameId);
        await queries.resetGameToLobby(gameId);
        await queries.deleteGameState(gameId);

        io.to(gameRoom(gameId)).emit('game:returnToLobby', { roomCode: game.room_code });
      } catch (err) {
        socket.emit('error:toast', 'Could not restart the lobby');
      }
    });

    socket.on('disconnect', async () => {
      try {
        const { gameId, playerId } = socket.data;
        if (gameId && playerId) {
          gameManager.setConnected(gameId, playerId, false);
          await queries.setPlayerConnected(gameId, playerId, false);
          await broadcastGameState(io, gameId);
          const game = await queries.getGameById(gameId);
          if (game) await broadcastLobby(io, game);
        }
      } catch (err) {
        // best-effort cleanup only
      }
    });
  });
}

module.exports = { registerSocketHandlers };
