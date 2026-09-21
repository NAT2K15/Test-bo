const deck = require('./deck');
const { dealStockpilesAndDrawPile, stockpileSizeFor } = require('./deal');
const rules = require('./rules');
const constants = require('./constants');

/** Creates a brand-new game state for the given ordered player names and
 * kicks off seat 0's first turn (draws their opening hand of 5). */
function createGame(playerNames, options = {}) {
  const state = dealStockpilesAndDrawPile(playerNames, options);
  rules.startTurn(state, 0);
  return state;
}

/** Builds the view of state a specific seat is allowed to see: their own
 * hand in full, and only public information about everyone else. Never
 * leaks other players' hands or face-down stockpile cards. */
function getPublicState(state, forSeat) {
  return {
    status: state.status,
    winnerSeat: state.winnerSeat,
    currentTurnSeat: state.currentTurnSeat,
    drawPileCount: state.drawPile.length,
    buildingPiles: state.buildingPiles.map((pile) => ({
      cards: pile.slice(),
      topCard: rules.peekTop(pile) ?? null,
      nextNeeded: rules.getPileNextNeeded(pile),
    })),
    log: state.log.slice(-25),
    players: state.players.map((p) => {
      const isSelf = p.seat === forSeat;
      return {
        seat: p.seat,
        name: p.name,
        connected: p.connected,
        stockpileCount: p.stockpile.length,
        stockpileTop: rules.peekTop(p.stockpile) ?? null,
        discardPiles: p.discardPiles.map((pile) => ({
          // Discard piles sit face-up on the table in real Skip-Bo, so the
          // full pile (not just the top) is legitimately public info.
          cards: pile.slice(),
          topCard: rules.peekTop(pile) ?? null,
          count: pile.length,
        })),
        hand: isSelf ? p.hand.slice() : undefined,
        handCount: p.hand.length,
      };
    }),
  };
}

module.exports = {
  ...deck,
  ...rules,
  ...constants,
  dealStockpilesAndDrawPile,
  stockpileSizeFor,
  createGame,
  getPublicState,
};
