require('dotenv').config();
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const { sessionMiddleware } = require('./db/sessionStore');
const pool = require('./db/pool');
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
  const [rows] = await pool.query("SELECT id FROM games WHERE status = 'active'");
  for (const row of rows) {
    try {
      await gameManager.restoreGame(row.id);
    } catch (err) {
      console.error(`Failed to restore game ${row.id}:`, err.message);
    }
  }
  if (rows.length > 0) {
    console.log(`Restored ${rows.length} active game(s) from the database.`);
  }
}

const PORT = process.env.PORT || 3000;

restoreActiveGames()
  .catch((err) => console.error('Startup restore failed:', err.message))
  .finally(() => {
    server.listen(PORT, () => {
      console.log(`Skip-Bo server listening on http://localhost:${PORT}`);
    });
  });

module.exports = { app, server, io };
