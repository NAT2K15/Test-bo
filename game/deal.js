const { createDeck, shuffle } = require('./deck');
const {
  STOCKPILE_SIZE_SMALL,
  STOCKPILE_SIZE_LARGE,
  SMALL_GROUP_MAX_PLAYERS,
  NUM_DISCARD_PILES,
  NUM_BUILDING_PILES,
  MIN_PLAYERS,
  MAX_PLAYERS,
} = require('./constants');

function stockpileSizeFor(playerCount) {
  return playerCount <= SMALL_GROUP_MAX_PLAYERS
    ? STOCKPILE_SIZE_SMALL
    : STOCKPILE_SIZE_LARGE;
}

/**
 * Deals stockpiles to each player and forms the shared draw pile from the
 * remainder of a freshly shuffled deck. Hands start empty; they are filled
 * by the turn-start draw step (see rules.js#startTurn), matching official
 * Skip-Bo setup where no separate starting hand is dealt.
 *
 * @param {string[]} playerNames - ordered by seat
 * @param {{stockpileSize?: number}} [options] - override the official
 *   30/20-card stockpile size (e.g. for shorter custom games)
 */
function dealStockpilesAndDrawPile(playerNames, options = {}) {
  const playerCount = playerNames.length;
  if (playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) {
    throw new Error(
      `Skip-Bo requires between ${MIN_PLAYERS} and ${MAX_PLAYERS} players`
    );
  }

  const stockpileSize = options.stockpileSize || stockpileSizeFor(playerCount);
  const deck = shuffle(createDeck());

  let idx = 0;
  const players = playerNames.map((name, seat) => {
    const stockpile = deck.slice(idx, idx + stockpileSize);
    idx += stockpileSize;
    return {
      seat,
      name,
      connected: true,
      hand: [],
      stockpile,
      discardPiles: Array.from({ length: NUM_DISCARD_PILES }, () => []),
    };
  });

  const drawPile = deck.slice(idx);

  return {
    players,
    drawPile,
    buildingPiles: Array.from({ length: NUM_BUILDING_PILES }, () => []),
    completedPiles: [],
    currentTurnSeat: 0,
    status: 'active',
    winnerSeat: null,
    log: [],
  };
}

module.exports = { dealStockpilesAndDrawPile, stockpileSizeFor };
