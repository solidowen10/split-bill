// lib/sso.js
//
// Express middleware that checks login status against the shared luru auth
// service instead of doing its own LINE OAuth flow.
//
// HOW IT WORKS
// ────────────
// 1. Browser makes a request to split-bill (e.g. GET /split-bill/g/abc123)
// 2. The browser automatically includes the shared luru_session cookie it got
//    from logging in at /auth/login. Cookies are sent for all paths on
//    tool.selinnaowen.com, so nothing special is needed in the browser.
// 3. This middleware forwards that cookie to /auth/api/session
//    (server-to-server on localhost, fast).
// 4. If the response says authenticated=true, req.lineUser is populated
//    and the handler continues normally.
// 5. If not, the visitor is redirected to /auth/login with a
//    ?next= param so they land right back where they tried to go.
//
// req.lineUser shape after a successful check:
//   {
//     lineUserId: "Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",  // same as members.line_user_id
//     name:       "Owen",
//     image:      "https://profile.line-scdn.net/..." | null
//   }

const AUTH_SESSION_URL =
  process.env.AUTH_SERVICE_INTERNAL_URL || 'http://127.0.0.1:3002/auth/api/session';

// Where to send users who aren't logged in yet.
const LOGIN_PATH = process.env.AUTH_SERVICE_BASE || '/auth';

async function requireLineSSO(req, res, next) {
  try {
    const response = await fetch(AUTH_SESSION_URL, {
      headers: { cookie: req.headers.cookie || '' },
    });

    if (!response.ok) {
      console.error(`[sso] auth session check returned ${response.status}`);
      return res.status(502).send('Login check failed — please try again.');
    }

    const data = await response.json();

    if (!data.authenticated) {
      const returnTo = encodeURIComponent(req.originalUrl);
      return res.redirect(`${LOGIN_PATH}/login?next=${returnTo}`);
    }

    if (!data.lineUserId) {
      console.error('[sso] auth service returned an authenticated user without a LINE account id');
      return res.status(502).send('Login check failed — LINE account was not linked.');
    }

    req.lineUser = {
      lineUserId: data.lineUserId,
      name:       data.name,
      image:      data.image,
    };

    // Back-fill the legacy session shape so all existing code that reads
    // req.session.lineProfile keeps working without any other changes.
    req.session.lineProfile = {
      userId:      data.lineUserId,
      displayName: data.name,
      pictureUrl:  data.image,
    };

    next();
  } catch (err) {
    console.error('[sso] Could not reach auth service:', err.message);
    res.status(502).send(
      'Could not verify login right now — is the auth service running?'
    );
  }
}

module.exports = { requireLineSSO };
