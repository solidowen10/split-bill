// server.js
require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');

const app = express();
app.set('trust proxy', 1);

// --- View engine ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// --- Base path support ---
// The app is mounted at /split-bill behind Nginx (tool.selinnaowen.com/split-bill).
// BASE_PATH lets the same code run standalone in dev (BASE_PATH='') or
// under a path prefix in production (BASE_PATH='/split-bill').
const BASE_PATH = process.env.BASE_PATH || '';
app.locals.basePath = BASE_PATH;

// --- Middleware ---
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(BASE_PATH + '/static', express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days
  },
}));

// --- Routes ---
const router = express.Router();
require('./routes/groups')(router);
require('./routes/auth')(router);
require('./routes/expenses')(router);
require('./routes/settlements')(router);
if (process.env.ENABLE_TEST_AUTH === '1') {
  require('./routes/test-only-auth')(router);
}

app.use(BASE_PATH, router);

// Friendly 404
app.use((req, res) => {
  res.status(404).send('Not found');
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send('Something went wrong: ' + err.message);
});

const PORT = process.env.PORT || 3300;
app.listen(PORT, () => {
  console.log(`Split Bill app running on port ${PORT} (base path: "${BASE_PATH}")`);
});
