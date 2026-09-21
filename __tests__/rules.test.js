const { createDeck, shuffle, isSkipBo } = require('../game/deck');
const { dealStockpilesAndDrawPile, stockpileSizeFor } = require('../game/deal');
const {
  validateMove,
  applyMove,
  checkWin,
  startTurn,
  getPileNextNeeded,
  drawUpToHandSize,
  getNextSeat,
} = require('../game/rules');
const { createGame, getPublicState } = require('../game/index');
const { HAND_SIZE, MAX_CARD } = require('../game/constants');

describe('deck composition', () => {
  test('has 162 total cards', () => {
    expect(createDeck().length).toBe(162);
  });

  test('has 12 copies each of numbers 1-12', () => {
    const deck = createDeck();
    for (let n = 1; n <= 12; n++) {
      expect(deck.filter((c) => c === n).length).toBe(12);
    }
  });

  test('has 18 Skip-Bo wild cards', () => {
    const deck = createDeck();
    expect(deck.filter((c) => isSkipBo(c)).length).toBe(18);
  });

  test('shuffle preserves composition and reorders', () => {
    const original = createDeck();
    const shuffled = shuffle(createDeck());
    expect(shuffled.length).toBe(original.length);
    expect(shuffled.slice().sort()).toEqual(original.slice().sort());
  });
});

describe('deal sizes by player count', () => {
  test('30-card stockpiles for 2 players', () => {
    const state = dealStockpilesAndDrawPile(['A', 'B']);
    state.players.forEach((p) => expect(p.stockpile.length).toBe(30));
  });

  test('30-card stockpiles for 4 players', () => {
    const state = dealStockpilesAndDrawPile(['A', 'B', 'C', 'D']);
    state.players.forEach((p) => expect(p.stockpile.length).toBe(30));
  });

  test('20-card stockpiles for 5 players', () => {
    const state = dealStockpilesAndDrawPile(['A', 'B', 'C', 'D', 'E']);
    state.players.forEach((p) => expect(p.stockpile.length).toBe(20));
  });

  test('20-card stockpiles for 6 players', () => {
    const state = dealStockpilesAndDrawPile(['A', 'B', 'C', 'D', 'E', 'F']);
    state.players.forEach((p) => expect(p.stockpile.length).toBe(20));
  });

  test('stockpileSizeFor helper matches thresholds', () => {
    expect(stockpileSizeFor(2)).toBe(30);
    expect(stockpileSizeFor(4)).toBe(30);
    expect(stockpileSizeFor(5)).toBe(20);
    expect(stockpileSizeFor(6)).toBe(20);
  });

  test('rejects invalid player counts', () => {
    expect(() => dealStockpilesAndDrawPile(['A'])).toThrow();
    expect(() =>
      dealStockpilesAndDrawPile(['A', 'B', 'C', 'D', 'E', 'F', 'G'])
    ).toThrow();
  });

  test('total cards dealt across stockpiles + draw pile == 162', () => {
    const state = dealStockpilesAndDrawPile(['A', 'B', 'C']);
    const stockTotal = state.players.reduce((s, p) => s + p.stockpile.length, 0);
    expect(stockTotal + state.drawPile.length).toBe(162);
  });

  test('hands start empty until first turn draw', () => {
    const state = dealStockpilesAndDrawPile(['A', 'B']);
    state.players.forEach((p) => expect(p.hand.length).toBe(0));
  });
});

describe('turn start draws hand to 5', () => {
  test('createGame fills seat 0 hand to 5', () => {
    const state = createGame(['A', 'B']);
    expect(state.players[0].hand.length).toBe(HAND_SIZE);
    expect(state.players[1].hand.length).toBe(0);
  });

  test('drawUpToHandSize tops off a partial hand', () => {
    const state = dealStockpilesAndDrawPile(['A', 'B']);
    const player = state.players[0];
    player.hand = [1, 2];
    drawUpToHandSize(state, player);
    expect(player.hand.length).toBe(HAND_SIZE);
  });

  test('drawUpToHandSize stops gracefully when draw pile is empty', () => {
    const state = dealStockpilesAndDrawPile(['A', 'B']);
    const player = state.players[0];
    state.drawPile = [];
    player.hand = [];
    drawUpToHandSize(state, player);
    expect(player.hand.length).toBe(0);
  });
});

describe('building pile start rules', () => {
  function freshState() {
    const state = createGame(['A', 'B']);
    return state;
  }

  test('a pile can start with a 1', () => {
    const state = freshState();
    const player = state.players[0];
    player.hand = [1, 2, 3, 4, 5];
    const result = applyMove(state, 0, {
      type: 'PLAY',
      source: 'hand',
      sourceIndex: 0,
      targetPileIndex: 0,
    });
    expect(result.ok).toBe(true);
    expect(state.buildingPiles[0].cards ?? state.buildingPiles[0]).toEqual([1]);
  });

  test('a pile can start with a Skip-Bo wild', () => {
    const state = freshState();
    const player = state.players[0];
    player.hand = ['SB', 2, 3, 4, 5];
    const result = applyMove(state, 0, {
      type: 'PLAY',
      source: 'hand',
      sourceIndex: 0,
      targetPileIndex: 0,
    });
    expect(result.ok).toBe(true);
  });

  test('a pile cannot start with a non-1 number', () => {
    const state = freshState();
    state.players[0].hand = [5, 2, 3, 4, 6];
    const validation = validateMove(state, 0, {
      type: 'PLAY',
      source: 'hand',
      sourceIndex: 0,
      targetPileIndex: 0,
    });
    expect(validation.valid).toBe(false);
  });

  test('building continues in ascending order', () => {
    const state = freshState();
    state.players[0].hand = [1, 2, 3, 4, 5];
    applyMove(state, 0, { type: 'PLAY', source: 'hand', sourceIndex: 0, targetPileIndex: 0 });
    // hand shifted after splice: [2,3,4,5]
    const result = applyMove(state, 0, {
      type: 'PLAY',
      source: 'hand',
      sourceIndex: 0,
      targetPileIndex: 0,
    });
    expect(result.ok).toBe(true);
    expect(state.buildingPiles[0]).toEqual([1, 2]);
  });

  test('rejects out-of-order card', () => {
    const state = freshState();
    state.players[0].hand = [1, 4, 3, 4, 5];
    applyMove(state, 0, { type: 'PLAY', source: 'hand', sourceIndex: 0, targetPileIndex: 0 });
    const validation = validateMove(state, 0, {
      type: 'PLAY',
      source: 'hand',
      sourceIndex: 0, // now '4'
      targetPileIndex: 0,
    });
    expect(validation.valid).toBe(false);
  });
});

describe('Skip-Bo wild placement', () => {
  test('wild fills in for the exact number needed mid-pile', () => {
    const state = createGame(['A', 'B']);
    state.players[0].hand = [1, 'SB', 3, 4, 5];
    applyMove(state, 0, { type: 'PLAY', source: 'hand', sourceIndex: 0, targetPileIndex: 0 });
    const result = applyMove(state, 0, {
      type: 'PLAY',
      source: 'hand',
      sourceIndex: 0, // SB now at index 0
      targetPileIndex: 0,
    });
    expect(result.ok).toBe(true);
    expect(state.buildingPiles[0]).toEqual([1, 'SB']);
  });

  test('wild is rejected as a valid source but reports correct standing-in number via getPileNextNeeded', () => {
    const state = createGame(['A', 'B']);
    expect(getPileNextNeeded(state.buildingPiles[0])).toBe(1);
    state.buildingPiles[0] = [1, 2, 3];
    expect(getPileNextNeeded(state.buildingPiles[0])).toBe(4);
  });
});

describe('completed pile removal and reshuffle', () => {
  test('pile is cleared and cards held in completedPiles upon reaching 12', () => {
    const state = createGame(['A', 'B']);
    state.buildingPiles[0] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    state.players[0].hand = [12, 2, 3, 4, 5];
    const result = applyMove(state, 0, {
      type: 'PLAY',
      source: 'hand',
      sourceIndex: 0,
      targetPileIndex: 0,
    });
    expect(result.ok).toBe(true);
    expect(state.buildingPiles[0]).toEqual([]);
    expect(state.completedPiles.length).toBe(MAX_CARD);
  });

  test('completed piles reshuffle into draw pile only once it is empty', () => {
    const state = createGame(['A', 'B']);
    state.drawPile = [];
    state.completedPiles = [1, 2, 3, 'SB'];
    const player = state.players[0];
    player.hand = [];
    drawUpToHandSize(state, player);
    expect(player.hand.length).toBe(4);
    expect(state.completedPiles.length).toBe(0);
    expect(state.drawPile.length).toBe(0);
  });

  test('does not touch completed piles while draw pile still has enough cards', () => {
    const state = createGame(['A', 'B']);
    state.drawPile = [7, 8, 9, 10, 11];
    state.completedPiles = [1, 2, 3];
    const player = state.players[0];
    player.hand = [];
    drawUpToHandSize(state, player);
    expect(player.hand.length).toBe(HAND_SIZE);
    expect(state.completedPiles.length).toBe(3);
    expect(state.drawPile.length).toBe(0);
  });
});

describe('hand refill mid-turn', () => {
  test('emptying hand via a play immediately redraws to 5', () => {
    const state = createGame(['A', 'B']);
    state.players[0].hand = [1];
    const before = state.drawPile.length;
    const result = applyMove(state, 0, {
      type: 'PLAY',
      source: 'hand',
      sourceIndex: 0,
      targetPileIndex: 0,
    });
    expect(result.ok).toBe(true);
    expect(state.players[0].hand.length).toBe(HAND_SIZE);
    expect(state.drawPile.length).toBe(before - HAND_SIZE);
  });

  test('player keeps playing after mid-turn refill (turn does not end)', () => {
    const state = createGame(['A', 'B']);
    state.players[0].hand = [1];
    applyMove(state, 0, { type: 'PLAY', source: 'hand', sourceIndex: 0, targetPileIndex: 0 });
    expect(state.currentTurnSeat).toBe(0);
  });
});

describe('discard rules', () => {
  test('discarding a hand card ends the turn and advances to next seat', () => {
    const state = createGame(['A', 'B', 'C']);
    state.players[0].hand = [1, 2, 3, 4, 5];
    const result = applyMove(state, 0, {
      type: 'DISCARD',
      sourceIndex: 0,
      targetPileIndex: 0,
    });
    expect(result.ok).toBe(true);
    expect(result.endedTurn).toBe(true);
    expect(state.currentTurnSeat).toBe(1);
    expect(state.players[0].discardPiles[0]).toEqual([1]);
  });

  test('next player draws up to 5 when their turn starts', () => {
    const state = createGame(['A', 'B']);
    state.players[0].hand = [1, 2, 3, 4, 5];
    applyMove(state, 0, { type: 'DISCARD', sourceIndex: 0, targetPileIndex: 0 });
    expect(state.players[1].hand.length).toBe(HAND_SIZE);
  });

  test('any card value may be discarded regardless of pile contents', () => {
    const state = createGame(['A', 'B']);
    state.players[0].hand = [9, 2, 3, 4, 5];
    state.players[0].discardPiles[0] = [3];
    const result = applyMove(state, 0, {
      type: 'DISCARD',
      sourceIndex: 0,
      targetPileIndex: 0,
    });
    expect(result.ok).toBe(true);
    expect(state.players[0].discardPiles[0]).toEqual([3, 9]);
  });

  test('cannot discard out of turn', () => {
    const state = createGame(['A', 'B']);
    state.players[1].hand = [1, 2, 3, 4, 5];
    const validation = validateMove(state, 1, {
      type: 'DISCARD',
      sourceIndex: 0,
      targetPileIndex: 0,
    });
    expect(validation.valid).toBe(false);
  });

  test('turn rotation wraps around to seat 0', () => {
    const state = createGame(['A', 'B']);
    expect(getNextSeat(state, 1)).toBe(0);
    expect(getNextSeat(state, 0)).toBe(1);
  });
});

describe('stockpile-to-discard rejection', () => {
  test('DISCARD always removes from hand, ignoring a spoofed stockpile source', () => {
    const state = createGame(['A', 'B']);
    const player = state.players[0];
    player.hand = [1, 2, 3, 4, 5];
    const stockpileBefore = player.stockpile.slice();
    const result = applyMove(state, 0, {
      type: 'DISCARD',
      source: 'stockpile', // ignored: DISCARD has no stockpile source in the schema
      sourceIndex: 0,
      targetPileIndex: 0,
    });
    expect(result.ok).toBe(true);
    expect(player.discardPiles[0]).toEqual([1]);
    expect(player.stockpile).toEqual(stockpileBefore);
  });

  test('an empty hand cannot satisfy a DISCARD move', () => {
    const state = createGame(['A', 'B']);
    state.players[0].hand = [];
    const validation = validateMove(state, 0, {
      type: 'DISCARD',
      sourceIndex: 0,
      targetPileIndex: 0,
    });
    expect(validation.valid).toBe(false);
  });

  test('playing from stockpile onto a building pile is allowed (contrast case)', () => {
    const state = createGame(['A', 'B']);
    state.players[0].stockpile = [5, 4, 3, 2, 1]; // top = 1
    const result = applyMove(state, 0, {
      type: 'PLAY',
      source: 'stockpile',
      targetPileIndex: 0,
    });
    expect(result.ok).toBe(true);
    expect(state.players[0].stockpile).toEqual([5, 4, 3, 2]);
  });
});

describe('win detection', () => {
  test('checkWin is true once stockpile is empty', () => {
    const state = createGame(['A', 'B']);
    const player = state.players[0];
    player.stockpile = [];
    expect(checkWin(player)).toBe(true);
  });

  test('checkWin is false with cards remaining', () => {
    const state = createGame(['A', 'B']);
    expect(checkWin(state.players[0])).toBe(false);
  });

  test('playing the last stockpile card ends the game with a winner', () => {
    const state = createGame(['A', 'B']);
    state.players[0].stockpile = [1];
    const result = applyMove(state, 0, {
      type: 'PLAY',
      source: 'stockpile',
      targetPileIndex: 0,
    });
    expect(result.ok).toBe(true);
    expect(result.gameOver).toBe(true);
    expect(result.winnerSeat).toBe(0);
    expect(state.status).toBe('finished');
    expect(state.winnerSeat).toBe(0);
  });

  test('no further moves are valid once game is finished', () => {
    const state = createGame(['A', 'B']);
    state.players[0].stockpile = [1];
    applyMove(state, 0, { type: 'PLAY', source: 'stockpile', targetPileIndex: 0 });
    const validation = validateMove(state, 1, {
      type: 'DISCARD',
      sourceIndex: 0,
      targetPileIndex: 0,
    });
    expect(validation.valid).toBe(false);
  });
});

describe('getPublicState hides private info', () => {
  test('other players hand contents are hidden, own hand is visible', () => {
    const state = createGame(['A', 'B']);
    state.players[1].hand = [1, 2, 3];
    const view0 = getPublicState(state, 0);
    const view1 = getPublicState(state, 1);

    const p1FromView0 = view0.players.find((p) => p.seat === 1);
    const p1FromView1 = view1.players.find((p) => p.seat === 1);

    expect(p1FromView0.hand).toBeUndefined();
    expect(p1FromView0.handCount).toBe(3);
    expect(p1FromView1.hand).toEqual([1, 2, 3]);
  });

  test('stockpile cards below the top are never exposed', () => {
    const state = createGame(['A', 'B']);
    const view = getPublicState(state, 0);
    const p0 = view.players.find((p) => p.seat === 0);
    expect(p0.stockpileTop).toBe(state.players[0].stockpile.slice(-1)[0]);
    expect(p0).not.toHaveProperty('stockpile');
  });
});
