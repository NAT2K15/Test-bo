(function () {
  const main = document.querySelector('main[data-room-code]');
  const roomCode = main.dataset.roomCode;
  const isHost = main.dataset.isHost === 'true';

  const socket = io();
  const toastEl = document.getElementById('toast');
  const turnIndicatorEl = document.getElementById('turn-indicator');
  const opponentsEl = document.getElementById('opponents');
  const buildingPilesEl = document.getElementById('building-piles');
  const drawCountEl = document.getElementById('draw-count');
  const myStockpileEl = document.getElementById('my-stockpile');
  const myDiscardPilesEl = document.getElementById('my-discard-piles');
  const myHandEl = document.getElementById('my-hand');
  const moveLogEl = document.getElementById('move-log');
  const gameOverEl = document.getElementById('game-over');
  const winnerTextEl = document.getElementById('winner-text');
  const playAgainBtn = document.getElementById('play-again-btn');
  const playAgainWaitEl = document.getElementById('play-again-wait');

  let latestState = null;
  let mySeat = null;
  let selected = null; // { source: 'hand'|'stockpile'|'discard', sourceIndex, card }

  function showToast(message) {
    toastEl.textContent = message;
    toastEl.classList.remove('hidden');
    setTimeout(() => toastEl.classList.add('hidden'), 4000);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function cardLabel(card) {
    return card === 'SB' ? 'SB' : String(card);
  }

  function makeCardEl(card, { faceDown = false, empty = false } = {}) {
    const el = document.createElement('div');
    el.className = 'card';

    if (faceDown) {
      el.classList.add('face-down');
      return el;
    }
    if (empty) {
      el.classList.add('empty-slot');
      return el;
    }

    const label = cardLabel(card);
    el.dataset.value = label;
    if (card === 'SB') {
      el.classList.add('skipbo');
      el.innerHTML = '<span class="star">&#9733;</span><span class="center-pip">SB</span><span class="star">&#9733;</span>';
    } else {
      el.classList.add(`card-num-${card}`);
      el.innerHTML = `
        <span class="corner corner-tl">${label}</span>
        <span class="center-pip">${label}</span>
        <span class="corner corner-br">${label}</span>
      `;
    }
    return el;
  }

  function isMyTurn() {
    return latestState && mySeat === latestState.currentTurnSeat;
  }

  function isLegalBuildingTarget(card, pile) {
    return card === 'SB' || card === pile.nextNeeded;
  }

  function clearSelection() {
    selected = null;
    render();
  }

  function selectCard(source, sourceIndex, card) {
    if (!isMyTurn()) return;
    if (
      selected &&
      selected.source === source &&
      selected.sourceIndex === sourceIndex
    ) {
      clearSelection();
      return;
    }
    selected = { source, sourceIndex, card };
    render();
  }

  function sendMove(move) {
    socket.emit('game:move', move);
    selected = null;
  }

  function playOnBuildingPile(targetPileIndex) {
    if (!selected) return;
    const move = {
      type: 'PLAY',
      source: selected.source,
      targetPileIndex,
    };
    if (selected.source === 'hand' || selected.source === 'discard') {
      move.sourceIndex = selected.sourceIndex;
    }
    sendMove(move);
  }

  function discardToPile(targetPileIndex) {
    if (!selected || selected.source !== 'hand') return;
    sendMove({ type: 'DISCARD', sourceIndex: selected.sourceIndex, targetPileIndex });
  }

  function renderTurnIndicator() {
    const current = latestState.players.find((p) => p.seat === latestState.currentTurnSeat);
    if (latestState.status === 'finished') {
      turnIndicatorEl.textContent = 'Game Over';
      turnIndicatorEl.className = 'text-lg font-semibold px-4 py-2 rounded-md bg-slate-800';
      return;
    }
    const mine = mySeat === latestState.currentTurnSeat;
    turnIndicatorEl.textContent = mine ? 'Your turn' : `${current.name}'s turn`;
    turnIndicatorEl.className =
      'text-lg font-semibold px-4 py-2 rounded-md ' +
      (mine ? 'bg-emerald-600 text-white' : 'bg-slate-800');
  }

  function renderOpponents() {
    opponentsEl.innerHTML = '';
    latestState.players
      .filter((p) => p.seat !== mySeat)
      .forEach((p) => {
        const card = document.createElement('div');
        card.className = 'bg-slate-800 rounded-lg p-4';
        const isTurn = p.seat === latestState.currentTurnSeat;
        card.innerHTML = `
          <div class="flex items-center justify-between mb-3">
            <span class="font-semibold ${isTurn ? 'text-emerald-400' : ''}">${escapeHtml(p.name)}</span>
            <span class="w-2.5 h-2.5 rounded-full ${p.connected ? 'bg-emerald-400' : 'bg-slate-500'}"></span>
          </div>
          <div class="flex gap-4 items-start">
            <div class="pile-wrap">
              <span class="pile-label">Stockpile (${p.stockpileCount})</span>
              <div class="stockpile-slot"></div>
            </div>
            <div class="pile-wrap">
              <span class="pile-label">Discards</span>
              <div class="flex gap-1 discard-slots"></div>
            </div>
          </div>
          <p class="text-xs text-slate-500 mt-2">Hand: ${p.handCount} card(s)</p>
        `;
        const stockSlot = card.querySelector('.stockpile-slot');
        stockSlot.appendChild(
          p.stockpileTop != null
            ? makeCardEl(p.stockpileTop)
            : makeCardEl(null, { empty: true })
        );
        const discardSlots = card.querySelector('.discard-slots');
        p.discardPiles.forEach((pile) => {
          discardSlots.appendChild(
            pile.topCard != null ? makeCardEl(pile.topCard) : makeCardEl(null, { empty: true })
          );
        });
        opponentsEl.appendChild(card);
      });
  }

  function renderBuildingPiles() {
    drawCountEl.textContent = latestState.drawPileCount;
    buildingPilesEl.innerHTML = '';
    latestState.buildingPiles.forEach((pile, idx) => {
      const wrap = document.createElement('div');
      wrap.className = 'pile-wrap';
      const label = document.createElement('span');
      label.className = 'pile-label';
      label.textContent = `Pile ${idx + 1} (needs ${pile.nextNeeded})`;
      wrap.appendChild(label);

      const cardEl =
        pile.topCard != null ? makeCardEl(pile.topCard) : makeCardEl(null, { empty: true });

      if (pile.topCard === 'SB') {
        const sub = document.createElement('div');
        sub.className = 'subnote';
        sub.textContent = `as ${pile.cards.length}`;
        wrap.style.position = 'relative';
        wrap.appendChild(sub);
      }

      if (selected && isLegalBuildingTarget(selected.card, pile)) {
        cardEl.classList.add('legal-target');
        cardEl.addEventListener('click', () => playOnBuildingPile(idx));
      }

      wrap.appendChild(cardEl);
      buildingPilesEl.appendChild(wrap);
    });
  }

  function renderMyArea() {
    const me = latestState.players.find((p) => p.seat === mySeat);
    if (!me) return;

    myStockpileEl.innerHTML = '';
    const stockWrap = document.createElement('div');
    stockWrap.className = 'pile-wrap';
    stockWrap.innerHTML = `<span class="pile-label">${me.stockpileCount} left</span>`;
    const stockCard =
      me.stockpileTop != null ? makeCardEl(me.stockpileTop) : makeCardEl(null, { empty: true });
    if (me.stockpileTop != null) {
      if (
        selected &&
        selected.source === 'stockpile' &&
        selected.card === me.stockpileTop
      ) {
        stockCard.classList.add('selected');
      }
      stockCard.addEventListener('click', () =>
        selectCard('stockpile', null, me.stockpileTop)
      );
    }
    stockWrap.appendChild(stockCard);
    myStockpileEl.appendChild(stockWrap);

    myDiscardPilesEl.innerHTML = '';
    me.discardPiles.forEach((pile, idx) => {
      const wrap = document.createElement('div');
      wrap.className = 'pile-wrap';
      wrap.innerHTML = `<span class="pile-label">Pile ${idx + 1}</span>`;
      const cardEl =
        pile.topCard != null ? makeCardEl(pile.topCard) : makeCardEl(null, { empty: true });

      const canDiscardHere = selected && selected.source === 'hand';
      if (canDiscardHere) {
        cardEl.classList.add('legal-target');
        cardEl.addEventListener('click', () => discardToPile(idx));
      } else if (pile.topCard != null) {
        if (
          selected &&
          selected.source === 'discard' &&
          selected.sourceIndex === idx
        ) {
          cardEl.classList.add('selected');
        }
        cardEl.addEventListener('click', () => selectCard('discard', idx, pile.topCard));
      }
      wrap.appendChild(cardEl);
      myDiscardPilesEl.appendChild(wrap);
    });

    myHandEl.innerHTML = '';
    (me.hand || []).forEach((card, idx) => {
      const cardEl = makeCardEl(card);
      if (selected && selected.source === 'hand' && selected.sourceIndex === idx) {
        cardEl.classList.add('selected');
      }
      cardEl.addEventListener('click', () => selectCard('hand', idx, card));
      myHandEl.appendChild(cardEl);
    });
  }

  function renderLog() {
    moveLogEl.innerHTML = '';
    const entries = latestState.log.slice().reverse();
    entries.forEach((entry) => {
      const player = latestState.players.find((p) => p.seat === entry.seat);
      const name = player ? player.name : `Seat ${entry.seat}`;
      let text = '';
      if (entry.type === 'PLAY') {
        text = `${name} played ${cardLabel(entry.card)} from ${entry.source} onto pile ${entry.targetPileIndex + 1}`;
      } else if (entry.type === 'DISCARD') {
        text = `${name} discarded ${cardLabel(entry.card)} onto their pile ${entry.targetPileIndex + 1}`;
      } else if (entry.type === 'AUTO_DISCARD') {
        text = `${name} ran out of time and auto-discarded`;
      }
      const li = document.createElement('li');
      li.textContent = text;
      moveLogEl.appendChild(li);
    });
  }

  function renderGameOver() {
    if (latestState.status !== 'finished') {
      gameOverEl.classList.add('hidden');
      return;
    }
    gameOverEl.classList.remove('hidden');
    const winner = latestState.players.find((p) => p.seat === latestState.winnerSeat);
    winnerTextEl.textContent =
      latestState.winnerSeat === mySeat
        ? 'You win!'
        : `${winner ? winner.name : 'A player'} wins!`;

    if (isHost) {
      playAgainBtn.classList.remove('hidden');
      playAgainWaitEl.classList.add('hidden');
    } else {
      playAgainBtn.classList.add('hidden');
      playAgainWaitEl.classList.remove('hidden');
    }
  }

  function render() {
    if (!latestState) return;
    renderTurnIndicator();
    renderOpponents();
    renderBuildingPiles();
    renderMyArea();
    renderLog();
    renderGameOver();
  }

  socket.on('connect', () => socket.emit('game:join', roomCode));

  socket.on('game:state', (data) => {
    latestState = data;
    const me = data.players.find((p) => p.hand !== undefined);
    if (me) mySeat = me.seat;
    render();
  });

  socket.on('error:toast', showToast);

  socket.on('game:returnToLobby', ({ roomCode }) => {
    window.location.href = `/lobby/${roomCode}`;
  });

  playAgainBtn.addEventListener('click', () => {
    socket.emit('game:playAgain');
  });
})();
