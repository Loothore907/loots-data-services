const express = require('express');
const router = express.Router();

// Home page
router.get('/', function(req, res) {
  res.render('index', { title: 'Loot\'s Ganja Guide Admin' });
});

// Logout route
router.get('/logout', function(req, res) {
  // TODO: Add actual logout logic here
  res.redirect('/');
});

module.exports = router; 