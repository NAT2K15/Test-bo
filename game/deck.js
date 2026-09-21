const crypto = require('crypto');
const {
  SKIP_BO,
  MIN_CARD,
  MAX_CARD,
  SKIP_BO_COUNT,
  COPIES_PER_NUMBER,
} = require('./constants');

/**
 * Builds a fresh, unshuffled 162-card Skip-Bo deck:
 * 12 copies each of 1-12 (144 cards) + 18 Skip-Bo wilds.
 */
function createDeck() {
  const deck = [];
  for (let num = MIN_CARD; num <= MAX_CARD; num++) {
    for (let i = 0; i < COPIES_PER_NUMBER; i++) {
      deck.push(num);
    }
  }
  for (let i = 0; i < SKIP_BO_COUNT; i++) {
    deck.push(SKIP_BO);
  }
  return deck;
}

/**
 * Fisher-Yates shuffle using crypto.randomInt for unbiased,
 * cryptographically strong randomness (never Math.random).
 * Mutates and returns the given array.
 */
function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function isSkipBo(card) {
  return card === SKIP_BO;
}

module.exports = { createDeck, shuffle, isSkipBo };
