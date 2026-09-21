(function () {
  const main = document.querySelector('main[data-room-code]');
  const roomCode = main.dataset.roomCode;
  const isHost = main.dataset.isHost === 'true';

  const socket = io();
  const toastEl = document.getElementById('toast');
  const turnIndicatorEl = document.getElementById('turn-indicator');
  const opponentsEl = document.getElementById('opponents');
  const buildingPilesEl = document.getElementById('building-piles');
  const drawPileVisualEl = document.getElementById('draw-pile-visual');
  const myAreaPanelEl = document.getElementById('my-area-panel');
  const myStockpileEl = document.getElementById('my-stockpile');
  const myDiscardPilesEl = document.getElementById('my-discard-piles');
  const myHandEl = document.getElementById('my-hand');
  const gameOverEl = document.getElementById('game-over');
  const winnerTextEl = document.getElementById('winner-text');
  const playAgainBtn = document.getElementById('play-again-btn');
  const playAgainWaitEl = document.getElementById('play-again-wait');
  const myReactionBtn = document.getElementById('my-reaction-btn');
  const myReactionPicker = document.getElementById('my-reaction-picker');

  const REACTIONS = ['😀', '😘', '😢', '😲', '😜', '😳'];
  const DRAG_THRESHOLD = 6;

  let latestState = null;
  let mySeat = null;
  let selected = null; // { source: 'hand'|'stockpile'|'discard', sourceIndex, card }
  let prevHandCount = 0;

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
      el.innerHTML = '<span class="back-logo">SKIP<br>BO</span>';
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
      el.innerHTML = '<span class="skipbo-logo">SKIP<br>BO</span>';
    } else {
      // Two alternating accent colors, like a real deck's mixed card stock.
      el.classList.add(card % 2 === 0 ? 'theme-red' : 'theme-green');
      el.innerHTML = `
        <span class="corner-badge">${label}</span>
        <span class="center-pip">${label}</span>
        <span class="swoosh"></span>
      `;
    }
    return el;
  }

  /** A discard pile shown as a small stack: the card just under the top
   * peeking out behind it, even though only the top card is playable. */
  function renderDiscardStack(pile) {
    const stack = document.createElement('div');
    stack.className = 'discard-stack';
    const cards = pile.cards || [];
    if (cards.length === 0) {
      stack.appendChild(makeCardEl(null, { empty: true }));
      return stack;
    }
    if (cards.length >= 2) {
      const peekCard = makeCardEl(cards[cards.length - 2]);
      peekCard.classList.add('peek');
      stack.appendChild(peekCard);
    }
    const topCard = makeCardEl(cards[cards.length - 1]);
    topCard.classList.add('top');
    stack.appendChild(topCard);
    return stack;
  }

  function isMyTurn() {
    return latestState && mySeat === latestState.currentTurnSeat;
  }

  function isLegalBuildingTarget(card, pile) {
    return card === 'SB' || card === pile.nextNeeded;
  }

  function buildPlayMove(source, sourceIndex, targetPileIndex) {
    const move = { type: 'PLAY', source, targetPileIndex };
    if (source === 'hand' || source === 'discard') move.sourceIndex = sourceIndex;
    return move;
  }

  function clearSelection() {
    selected = null;
    render();
  }

  function selectCard(source, sourceIndex, card) {
    if (!isMyTurn()) return;
    if (selected && selected.source === source && selected.sourceIndex === sourceIndex) {
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
    sendMove(buildPlayMove(selected.source, selected.sourceIndex, targetPileIndex));
  }

  function discardToPile(targetPileIndex) {
    if (!selected || selected.source !== 'hand') return;
    sendMove({ type: 'DISCARD', sourceIndex: selected.sourceIndex, targetPileIndex });
  }

  // -- Drag and drop --------------------------------------------------------

  /** Adds 'legal-target' to every currently-rendered pile card that this
   * source card could legally land on, without rebuilding any DOM (so a
   * card mid-drag never gets orphaned by a re-render). Returns the list of
   * {el, kind, idx} targets found, for hover-tracking and drop resolution. */
  function highlightLegalTargets(card, source) {
    const targets = [];
    buildingPilesEl.querySelectorAll('.pile-wrap').forEach((wrap, idx) => {
      const cardEl = wrap.querySelector('.card');
      const pile = latestState.buildingPiles[idx];
      if (cardEl && isLegalBuildingTarget(card, pile)) {
        cardEl.classList.add('legal-target');
        targets.push({ el: cardEl, kind: 'building', idx });
      }
    });
    if (source === 'hand') {
      myDiscardPilesEl.querySelectorAll('.discard-stack').forEach((stack, idx) => {
        const cardEl = stack.querySelector('.top, .empty-slot');
        if (cardEl) {
          cardEl.classList.add('legal-target');
          targets.push({ el: cardEl, kind: 'discard', idx });
        }
      });
    }
    return targets;
  }

  function clearAllHighlights() {
    document.querySelectorAll('.card.legal-target, .card.drop-hover').forEach((el) => {
      el.classList.remove('legal-target', 'drop-hover');
    });
  }

  function attachDragAndSelect(el, source, sourceIndex, card) {
    el.addEventListener('pointerdown', (ev) => {
      if (!isMyTurn() || ev.button === 2) return;
      clearAllHighlights();

      const startX = ev.clientX;
      const startY = ev.clientY;
      let dragging = false;
      let ghost = null;
      let targets = [];

      function positionGhost(e) {
        const w = el.offsetWidth;
        const h = el.offsetHeight;
        ghost.style.left = `${e.clientX - w / 2}px`;
        ghost.style.top = `${e.clientY - h / 2}px`;
        ghost.style.width = `${w}px`;
        ghost.style.height = `${h}px`;
      }

      function updateHover(e) {
        targets.forEach((t) => t.el.classList.remove('drop-hover'));
        const under = document.elementFromPoint(e.clientX, e.clientY);
        const match = targets.find((t) => t.el === under || t.el.contains(under));
        if (match) match.el.classList.add('drop-hover');
      }

      function onMove(e) {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (!dragging && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
          dragging = true;
          el.classList.add('dragging');
          ghost = el.cloneNode(true);
          ghost.classList.add('drag-ghost');
          ghost.classList.remove('dragging');
          document.body.appendChild(ghost);
          targets = highlightLegalTargets(card, source);
        }
        if (dragging) {
          positionGhost(e);
          updateHover(e);
        }
      }

      function onUp(e) {
        document.removeEventListener('pointermove', onMove);
        el.classList.remove('dragging');

        if (dragging) {
          const under = document.elementFromPoint(e.clientX, e.clientY);
          const match = targets.find((t) => t.el === under || t.el.contains(under));
          targets.forEach((t) => t.el.classList.remove('legal-target', 'drop-hover'));
          if (ghost) ghost.remove();
          if (match) {
            if (match.kind === 'building') {
              sendMove(buildPlayMove(source, sourceIndex, match.idx));
            } else if (match.kind === 'discard') {
              sendMove({ type: 'DISCARD', sourceIndex, targetPileIndex: match.idx });
            }
          }
        } else {
          selectCard(source, sourceIndex, card);
        }
      }

      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp, { once: true });
    });
  }

  // -- Emoji reactions --------------------------------------------------------

  function buildReactionPicker() {
    myReactionPicker.innerHTML = '';
    REACTIONS.forEach((emoji) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = emoji;
      btn.addEventListener('click', () => {
        socket.emit('game:reaction', emoji);
        myReactionPicker.classList.add('hidden');
      });
      myReactionPicker.appendChild(btn);
    });
  }

  function showFloatingReaction(seat, emoji) {
    const anchor =
      seat === mySeat ? myAreaPanelEl : opponentsEl.querySelector(`[data-seat="${seat}"]`);
    if (!anchor) return;
    const bubble = document.createElement('div');
    bubble.className = 'floating-reaction';
    bubble.textContent = emoji;
    anchor.appendChild(bubble);
    setTimeout(() => bubble.remove(), 2300);
  }

  myReactionBtn.addEventListener('click', () => myReactionPicker.classList.toggle('hidden'));

  // -- Rendering --------------------------------------------------------

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
        card.className = 'relative bg-slate-800 rounded-lg p-4';
        card.dataset.seat = p.seat;
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
              <div class="flex gap-2 discard-slots"></div>
            </div>
          </div>
          <span class="pile-label block mt-3">Hand (${p.handCount})</span>
          <div class="hand-fan"></div>
        `;
        const stockSlot = card.querySelector('.stockpile-slot');
        stockSlot.appendChild(
          p.stockpileTop != null
            ? makeCardEl(p.stockpileTop)
            : makeCardEl(null, { empty: true })
        );
        const discardSlots = card.querySelector('.discard-slots');
        p.discardPiles.forEach((pile) => {
          discardSlots.appendChild(renderDiscardStack(pile));
        });
        const fanEl = card.querySelector('.hand-fan');
        const shown = Math.min(p.handCount, 7);
        const mid = (shown - 1) / 2;
        for (let i = 0; i < shown; i++) {
          const back = makeCardEl(null, { faceDown: true });
          back.classList.add('fanned', 'mini');
          const offset = i - mid;
          back.style.transform = `rotate(${offset * 5}deg) translateY(${Math.abs(offset) * 3}px)`;
          fanEl.appendChild(back);
        }
        opponentsEl.appendChild(card);
      });
  }

  function renderDrawPile() {
    drawPileVisualEl.innerHTML = '';
    const count = latestState.drawPileCount;
    const shown = Math.min(3, count);
    for (let i = 0; i < shown; i++) {
      drawPileVisualEl.appendChild(makeCardEl(null, { faceDown: true }));
    }
    if (count === 0) {
      drawPileVisualEl.appendChild(makeCardEl(null, { empty: true }));
    }
    const badge = document.createElement('div');
    badge.className = 'draw-pile-count';
    badge.textContent = count;
    drawPileVisualEl.appendChild(badge);
  }

  function renderBuildingPiles() {
    buildingPilesEl.innerHTML = '';
    latestState.buildingPiles.forEach((pile, idx) => {
      const wrap = document.createElement('div');
      wrap.className = 'pile-wrap';
      wrap.style.position = 'relative';
      const label = document.createElement('span');
      label.className = 'pile-label';
      label.textContent = `Pile ${idx + 1}`;
      wrap.appendChild(label);

      const cardEl =
        pile.topCard != null ? makeCardEl(pile.topCard) : makeCardEl(null, { empty: true });

      if (pile.topCard === 'SB') {
        const sub = document.createElement('div');
        sub.className = 'subnote';
        sub.textContent = `as ${pile.cards.length}`;
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
      if (selected && selected.source === 'stockpile' && selected.card === me.stockpileTop) {
        stockCard.classList.add('selected');
      }
      attachDragAndSelect(stockCard, 'stockpile', null, me.stockpileTop);
    }
    stockWrap.appendChild(stockCard);
    myStockpileEl.appendChild(stockWrap);

    myDiscardPilesEl.innerHTML = '';
    me.discardPiles.forEach((pile, idx) => {
      const wrap = document.createElement('div');
      wrap.className = 'pile-wrap';
      wrap.innerHTML = `<span class="pile-label">Pile ${idx + 1}</span>`;
      const stack = renderDiscardStack(pile);
      const interactiveEl = stack.querySelector('.top, .empty-slot');

      const canDiscardHere = selected && selected.source === 'hand';
      if (interactiveEl && canDiscardHere) {
        interactiveEl.classList.add('legal-target');
        interactiveEl.addEventListener('click', () => discardToPile(idx));
      } else if (pile.topCard != null) {
        const topEl = stack.querySelector('.top');
        if (selected && selected.source === 'discard' && selected.sourceIndex === idx) {
          topEl.classList.add('selected');
        }
        attachDragAndSelect(topEl, 'discard', idx, pile.topCard);
      }
      wrap.appendChild(stack);
      myDiscardPilesEl.appendChild(wrap);
    });

    myHandEl.innerHTML = '';
    const hand = me.hand || [];
    const grownFrom = hand.length > prevHandCount ? prevHandCount : null;
    hand.forEach((card, idx) => {
      const cardEl = makeCardEl(card);
      if (grownFrom !== null && idx >= grownFrom) {
        cardEl.classList.add('deal-in');
        cardEl.style.animationDelay = `${(idx - grownFrom) * 60}ms`;
      }
      if (selected && selected.source === 'hand' && selected.sourceIndex === idx) {
        cardEl.classList.add('selected');
      }
      attachDragAndSelect(cardEl, 'hand', idx, card);
      myHandEl.appendChild(cardEl);
    });
    prevHandCount = hand.length;
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
    renderDrawPile();
    renderBuildingPiles();
    renderMyArea();
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

  socket.on('game:reaction', ({ seat, emoji }) => showFloatingReaction(seat, emoji));

  socket.on('game:returnToLobby', ({ roomCode }) => {
    window.location.href = `/lobby/${roomCode}`;
  });

  playAgainBtn.addEventListener('click', () => {
    socket.emit('game:playAgain');
  });

  buildReactionPicker();
})();
