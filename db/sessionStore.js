require('dotenv').config();
const session = require('express-session');

const useJson = (process.env.STORAGE || 'mysql').toLowerCase() === 'json';

let store;
if (useJson) {
  const JsonSessionStore = require('./jsonSessionStore');
  store = new JsonSessionStore();
} else {
  const MySQLStore = require('express-mysql-session')(session);
  const pool = require('./pool');
  store = new MySQLStore({}, pool);
}

const sessionMiddleware = session({
  key: 'skipbo.sid',
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  store,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 7, // 1 week
    httpOnly: true,
    sameSite: 'lax',
  },
});

module.exports = { sessionMiddleware, store };
