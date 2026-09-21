const session = require('express-session');
const store = require('./jsonStore');

/** express-session Store backed by the same JSON file as jsonQueries.js,
 * so STORAGE=json dev mode needs no MySQL for sessions either. */
class JsonSessionStore extends session.Store {
  get(sid, callback) {
    const rec = store.data.sessions[sid];
    if (!rec) return callback(null, null);
    if (rec.expires && rec.expires < Date.now()) {
      delete store.data.sessions[sid];
      store.persist();
      return callback(null, null);
    }
    callback(null, rec.data);
  }

  set(sid, sessionData, callback) {
    const maxAge = sessionData.cookie && sessionData.cookie.maxAge;
    store.data.sessions[sid] = {
      data: sessionData,
      expires: maxAge ? Date.now() + maxAge : null,
    };
    store.persist();
    if (callback) callback();
  }

  destroy(sid, callback) {
    delete store.data.sessions[sid];
    store.persist();
    if (callback) callback();
  }

  touch(sid, sessionData, callback) {
    this.set(sid, sessionData, callback);
  }
}

module.exports = JsonSessionStore;
