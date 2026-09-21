require('dotenv').config();
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const pool = require('./pool');

const store = new MySQLStore({}, pool);

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
