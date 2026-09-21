(function () {
  const main = document.querySelector('main[data-room-code]');
  const roomCode = main.dataset.roomCode;
  const isHost = main.dataset.isHost === 'true';

  const socket = io();
  const playerListEl = document.getElementById('player-list');
  const playerCountEl = document.getElementById('player-count');
  const startBtn = document.getElementById('start-btn');
  const turnTimerEl = document.getElementById('turn-timer');
  const stockpileSizeEl = document.getElementById('stockpile-size');
  const toastEl = document.getElementById('toast');

  function showToast(message) {
    toastEl.textContent = message;
    toastEl.classList.remove('hidden');
    setTimeout(() => toastEl.classList.add('hidden'), 4000);
  }

  socket.on('connect', () => socket.emit('lobby:join', roomCode));

  socket.on('lobby:state', (data) => {
    playerCountEl.textContent = data.players.length;
    playerListEl.innerHTML = '';
    data.players.forEach((p) => {
      const li = document.createElement('li');
      li.className = 'flex items-center justify-between bg-slate-700/60 rounded-md px-3 py-2';
      const isPlayerHost = p.playerId === data.hostPlayerId;
      li.innerHTML = `
        <span>${escapeHtml(p.name)}${isPlayerHost ? ' <span class="text-amber-400 text-xs">(host)</span>' : ''}</span>
        <span class="w-2.5 h-2.5 rounded-full ${p.connected ? 'bg-emerald-400' : 'bg-slate-500'}"></span>
      `;
      playerListEl.appendChild(li);
    });

    if (startBtn) {
      startBtn.disabled = data.players.length < 2;
    }
  });

  socket.on('lobby:started', ({ roomCode }) => {
    window.location.href = `/game/${roomCode}`;
  });

  socket.on('error:toast', showToast);

  if (startBtn) {
    startBtn.addEventListener('click', () => {
      socket.emit('lobby:start', {
        roomCode,
        turnTimerSeconds: turnTimerEl.value ? Number(turnTimerEl.value) : null,
        stockpileSize: stockpileSizeEl ? Number(stockpileSizeEl.value) : undefined,
      });
    });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
})();
