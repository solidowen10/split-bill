// lib/line-auth.js
//
// Minimal LINE Login (OAuth 2.0) helper. No SDK dependency — just axios
// against LINE's documented endpoints, matching the pattern likely already
// used in the camper tracker app.

const axios = require('axios');
const crypto = require('crypto');

const LINE_AUTH_URL = 'https://access.line.me/oauth2/v2.1/authorize';
const LINE_TOKEN_URL = 'https://api.line.me/oauth2/v2.1/token';
const LINE_PROFILE_URL = 'https://api.line.me/v2/profile';

function buildAuthUrl({ state, redirectUri }) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.LINE_LOGIN_CHANNEL_ID,
    redirect_uri: redirectUri,
    state,
    scope: 'profile openid',
  });
  return `${LINE_AUTH_URL}?${params.toString()}`;
}

async function exchangeCodeForToken({ code, redirectUri }) {
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: process.env.LINE_LOGIN_CHANNEL_ID,
    client_secret: process.env.LINE_LOGIN_CHANNEL_SECRET,
  });
  const res = await axios.post(LINE_TOKEN_URL, params, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  return res.data; // { access_token, id_token, ... }
}

async function getProfile(accessToken) {
  const res = await axios.get(LINE_PROFILE_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return res.data; // { userId, displayName, pictureUrl, statusMessage }
}

function randomState() {
  return crypto.randomBytes(16).toString('hex');
}

module.exports = { buildAuthUrl, exchangeCodeForToken, getProfile, randomState };
