const { shuffle, isSkipBo } = require('./deck');
const { MIN_CARD, MAX_CARD, HAND_SIZE } = require('./constants');

/** If the draw pile is empty and there are completed piles waiting, shuffle
 * them back in to form a new draw pile. Mutates state. */
function refillDrawPileIfEmpty(state) {
  if (state.drawPile.length === 0 && state.completedPiles.length > 0) {
    state.drawPile = shuffle(state.completedPiles.splice(0));
  }
}

/** Draws a single card from the draw pile, reshuffling completed piles in
 * first if necessary. Returns the card, or null if no cards remain anywhere. */
function drawOne(state) {
  refillDrawPileIfEmpty(state);
  if (state.drawPile.length === 0) return null;
  return state.drawPile.pop();
}

/** Draws cards into the given player's hand until it has 5 cards, or the
 * draw pile (and completed-pile reserve) is exhausted. Mutates state. */
function drawUpToHandSize(state, player) {
  while (player.hand.length < HAND_SIZE) {
    const card = drawOne(state);
    if (card === null) break;
    player.hand.push(card);
  }
}

/** Begins the turn for the given seat: fills that player's hand to 5. */
function startTurn(state, seat) {
  state.currentTurnSeat = seat;
  const player = getPlayer(state, seat);
  drawUpToHandSize(state, player);
}

function getPlayer(state, seat) {
  const player = state.players.find((p) => p.seat === seat);
  if (!player) throw new Error(`No player at seat ${seat}`);
  return player;
}

/** The number a building pile needs next (1 if empty, otherwise length+1). */
function getPileNextNeeded(pile) {
  return pile.length === 0 ? MIN_CARD : pile.length + 1;
}

function peekTop(pile) {
  return pile.length === 0 ? undefined : pile[pile.length - 1];
}

/**
 * Checks whether a move is legal without mutating state.
 * move: { type: 'PLAY', source: 'hand'|'stockpile'|'discard', sourceIndex, targetPileIndex }
 *     | { type: 'DISCARD', sourceIndex, targetPileIndex }
 */
function validateMove(state, seat, move) {
  if (state.status !== 'active') {
    return { valid: false, error: 'Game is not active' };
  }
  if (state.currentTurnSeat !== seat) {
    return { valid: false, error: 'Not your turn' };
  }
  const player = getPlayer(state, seat);
  if (!move || typeof move !== 'object') {
    return { valid: false, error: 'Invalid move' };
  }

  if (move.type === 'PLAY') {
    return validatePlay(state, player, move);
  }
  if (move.type === 'DISCARD') {
    return validateDiscard(state, player, move);
  }
  return { valid: false, error: `Unknown move type: ${move.type}` };
}

function validatePlay(state, player, move) {
  const { source, sourceIndex, targetPileIndex } = move;

  if (!['hand', 'stockpile', 'discard'].includes(source)) {
    return { valid: false, error: `Invalid source: ${source}` };
  }

  let card;
  if (source === 'hand') {
    if (
      !Number.isInteger(sourceIndex) ||
      sourceIndex < 0 ||
      sourceIndex >= player.hand.length
    ) {
      return { valid: false, error: 'Invalid hand index' };
    }
    card = player.hand[sourceIndex];
  } else if (source === 'stockpile') {
    if (player.stockpile.length === 0) {
      return { valid: false, error: 'Stockpile is empty' };
    }
    card = peekTop(player.stockpile);
  } else {
    if (
      !Number.isInteger(sourceIndex) ||
      sourceIndex < 0 ||
      sourceIndex >= player.discardPiles.length
    ) {
      return { valid: false, error: 'Invalid discard pile index' };
    }
    const pile = player.discardPiles[sourceIndex];
    if (pile.length === 0) {
      return { valid: false, error: 'That discard pile is empty' };
    }
    card = peekTop(pile);
  }

  if (
    !Number.isInteger(targetPileIndex) ||
    targetPileIndex < 0 ||
    targetPileIndex >= state.buildingPiles.length
  ) {
    return { valid: false, error: 'Invalid building pile index' };
  }
  const buildingPile = state.buildingPiles[targetPileIndex];
  const needed = getPileNextNeeded(buildingPile);

  const isWild = isSkipBo(card);
  if (!isWild && card !== needed) {
    return {
      valid: false,
      error: `Building pile needs ${needed}, card is ${card}`,
    };
  }

  return { valid: true, card };
}

function validateDiscard(state, player, move) {
  const { sourceIndex, targetPileIndex } = move;
  if (
    !Number.isInteger(sourceIndex) ||
    sourceIndex < 0 ||
    sourceIndex >= player.hand.length
  ) {
    return { valid: false, error: 'Invalid hand index' };
  }
  if (
    !Number.isInteger(targetPileIndex) ||
    targetPileIndex < 0 ||
    targetPileIndex >= player.discardPiles.length
  ) {
    return { valid: false, error: 'Invalid discard pile index' };
  }
  return { valid: true, card: player.hand[sourceIndex] };
}

/**
 * Applies a previously-validated move to the state, mutating it in place.
 * Returns a result descriptor: { ok, error?, gameOver?, winnerSeat?, endedTurn? }
 * Always re-validates internally so callers cannot bypass rule checks.
 */
function applyMove(state, seat, move) {
  const validation = validateMove(state, seat, move);
  if (!validation.valid) {
    return { ok: false, error: validation.error };
  }

  const player = getPlayer(state, seat);

  if (move.type === 'PLAY') {
    return applyPlay(state, player, move, validation.card);
  }
  return applyDiscard(state, player, move, validation.card);
}

function applyPlay(state, player, move, card) {
  const { source, sourceIndex, targetPileIndex } = move;

  if (source === 'hand') {
    player.hand.splice(sourceIndex, 1);
  } else if (source === 'stockpile') {
    player.stockpile.pop();
  } else {
    player.discardPiles[sourceIndex].pop();
  }

  const buildingPile = state.buildingPiles[targetPileIndex];
  buildingPile.push(card);

  if (buildingPile.length === MAX_CARD) {
    state.completedPiles.push(...buildingPile.splice(0, buildingPile.length));
  }

  state.log.push({
    type: 'PLAY',
    seat: player.seat,
    source,
    card,
    targetPileIndex,
  });

  if (source === 'stockpile' && player.stockpile.length === 0) {
    state.status = 'finished';
    state.winnerSeat = player.seat;
    return { ok: true, gameOver: true, winnerSeat: player.seat };
  }

  if (player.hand.length === 0) {
    drawUpToHandSize(state, player);
  }

  return { ok: true, gameOver: false };
}

function applyDiscard(state, player, move, card) {
  const { sourceIndex, targetPileIndex } = move;
  player.hand.splice(sourceIndex, 1);
  player.discardPiles[targetPileIndex].push(card);

  state.log.push({
    type: 'DISCARD',
    seat: player.seat,
    card,
    targetPileIndex,
  });

  const nextSeat = getNextSeat(state, player.seat);
  startTurn(state, nextSeat);

  return { ok: true, gameOver: false, endedTurn: true, nextSeat };
}

function getNextSeat(state, currentSeat) {
  const seats = state.players.map((p) => p.seat).sort((a, b) => a - b);
  const idx = seats.indexOf(currentSeat);
  return seats[(idx + 1) % seats.length];
}

function checkWin(player) {
  return player.stockpile.length === 0;
}

module.exports = {
  refillDrawPileIfEmpty,
  drawOne,
  drawUpToHandSize,
  startTurn,
  getPlayer,
  getPileNextNeeded,
  peekTop,
  validateMove,
  applyMove,
  checkWin,
  getNextSeat,
};
