require('dotenv').config();
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const { sessionMiddleware } = require('./db/sessionStore');
const queries = require('./db/queries');
const homeRoutes = require('./routes/home');
const gameRoutes = require('./routes/game');
const { registerSocketHandlers } = require('./sockets');
const gameManager = require('./sockets/gameManager');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(sessionMiddleware);

app.use(homeRoutes);
app.use(gameRoutes);

app.use((req, res) => {
  res.status(404).render('home', { displayName: req.session.displayName || '', error: 'Page not found' });
});

// Share the Express session with every Socket.IO connection.
io.engine.use(sessionMiddleware);
registerSocketHandlers(io);

async function restoreActiveGames() {
  const activeGameIds = await queries.getActiveGameIds();
  for (const gameId of activeGameIds) {
    try {
      await gameManager.restoreGame(gameId);
    } catch (err) {
      console.error(`Failed to restore game ${gameId}:`, err.message);
    }
  }
  if (activeGameIds.length > 0) {
    console.log(`Restored ${activeGameIds.length} active game(s) from storage.`);
  }
}

const PORT = process.env.PORT || 6767;
const STORAGE = (process.env.STORAGE || 'mysql').toLowerCase();

restoreActiveGames()
  .catch((err) => console.error('Startup restore failed:', err.message))
  .finally(() => {
    server.listen(PORT, () => {
      console.log(`Skip-Bo server listening on http://localhost:${PORT} (storage: ${STORAGE})`);
    });
  });

module.exports = { app, server, io };
