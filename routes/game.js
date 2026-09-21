const express = require('express');
const queries = require('../db/queries');
const { generateRoomCode } = require('../db/roomCode');
const { MIN_PLAYERS, MAX_PLAYERS } = require('../game/constants');

const router = express.Router();

function requireName(req, res, next) {
  if (!req.session.displayName || !req.session.playerId) {
    return res.redirect('/?error=' + encodeURIComponent('Enter your name first'));
  }
  next();
}

async function generateUniqueRoomCode() {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generateRoomCode();
    const existing = await queries.getGameByRoomCode(code);
    if (!existing) return code;
  }
  throw new Error('Could not generate a unique room code');
}

router.post('/game/create', requireName, async (req, res) => {
  const maxPlayers = Math.min(
    MAX_PLAYERS,
    Math.max(MIN_PLAYERS, parseInt(req.body.maxPlayers, 10) || MAX_PLAYERS)
  );
  const roomCode = await generateUniqueRoomCode();
  const gameId = await queries.createGameRow(roomCode, req.session.playerId, maxPlayers);
  await queries.addPlayerToGame(gameId, req.session.playerId, 0);
  res.redirect(`/lobby/${roomCode}`);
});

router.post('/game/join', requireName, async (req, res) => {
  const roomCode = (req.body.roomCode || '').trim().toUpperCase();
  const game = await queries.getGameByRoomCode(roomCode);
  if (!game) {
    return res.redirect('/?error=' + encodeURIComponent('Room not found'));
  }

  const players = await queries.getGamePlayers(game.id);
  const alreadySeated = players.some((p) => p.player_id === req.session.playerId);

  if (!alreadySeated) {
    if (game.status !== 'lobby') {
      return res.redirect('/?error=' + encodeURIComponent('That game has already started'));
    }
    if (players.length >= game.max_players) {
      return res.redirect('/?error=' + encodeURIComponent('That room is full'));
    }
    const seat = players.length;
    await queries.addPlayerToGame(game.id, req.session.playerId, seat);
  }

  res.redirect(`/lobby/${roomCode}`);
});

router.get('/lobby/:roomCode', requireName, async (req, res) => {
  const roomCode = req.params.roomCode.toUpperCase();
  const game = await queries.getGameByRoomCode(roomCode);
  if (!game) {
    return res.redirect('/?error=' + encodeURIComponent('Room not found'));
  }

  const players = await queries.getGamePlayers(game.id);
  const isSeated = players.some((p) => p.player_id === req.session.playerId);
  if (!isSeated) {
    return res.redirect('/?error=' + encodeURIComponent('You are not in that game'));
  }

  if (game.status === 'active') {
    return res.redirect(`/game/${roomCode}`);
  }

  res.render('lobby', {
    roomCode,
    maxPlayers: game.max_players,
    isHost: game.host_player_id === req.session.playerId,
    playerId: req.session.playerId,
    displayName: req.session.displayName,
  });
});

router.get('/game/:roomCode', requireName, async (req, res) => {
  const roomCode = req.params.roomCode.toUpperCase();
  const game = await queries.getGameByRoomCode(roomCode);
  if (!game) {
    return res.redirect('/?error=' + encodeURIComponent('Room not found'));
  }

  const players = await queries.getGamePlayers(game.id);
  const isSeated = players.some((p) => p.player_id === req.session.playerId);
  if (!isSeated) {
    return res.redirect('/?error=' + encodeURIComponent('You are not in that game'));
  }

  if (game.status === 'lobby') {
    return res.redirect(`/lobby/${roomCode}`);
  }

  res.render('game', {
    roomCode,
    playerId: req.session.playerId,
    displayName: req.session.displayName,
    isHost: game.host_player_id === req.session.playerId,
  });
});

module.exports = router;
