const express = require('express');
const queries = require('../db/queries');

const router = express.Router();

router.get('/', (req, res) => {
  res.render('home', {
    displayName: req.session.displayName || '',
    error: req.query.error || null,
  });
});

router.post('/name', async (req, res) => {
  const raw = (req.body.displayName || '').trim();
  if (!raw || raw.length > 30) {
    return res.redirect('/?error=' + encodeURIComponent('Enter a name up to 30 characters'));
  }
  const playerId = await queries.upsertPlayer(req.sessionID, raw);
  req.session.displayName = raw;
  req.session.playerId = playerId;
  req.session.save(() => res.redirect('/'));
});

module.exports = router;
