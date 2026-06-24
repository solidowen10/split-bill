// routes/auth.js  — SSO version
//
// LINE login is now handled entirely by the shared luru auth service at
// /auth/login. This file only deals with:
//   • /g/:groupId/join  — claiming a member slot after SSO login
//   • /g/:groupId/claim — writing the claim to the DB
//   • /auth/logout      — destroying the local session (the shared cookie
//                         is cleared by the spending tracker's own sign-out)
//
// The old /auth/line/callback route is GONE — no LINE OAuth happens here.
// The LINE Login Channel callback URL for split-bill is no longer needed
// (leave it in LINE Developers Console for now; it's harmless).

const { requireLineSSO } = require('../lib/sso');

function getDb() {
  if (process.env.USE_SANDBOX_DB === '1') {
    return require('../db/index.sandbox');
  }
  return require('../db');
}

module.exports = function (router) {
  const db = getDb();

  // ── Join page ─────────────────────────────────────────────────────────────
  // requireLineSSO runs first. If the visitor isn't logged in, they get
  // sent to /auth/login with ?next= pointing back here.
  // Once they log in, the auth service redirects them back and the
  // middleware populates req.session.lineProfile, so all existing code
  // that reads lineProfile continues to work unchanged.
  router.get('/g/:groupId/join', requireLineSSO, (req, res) => {
    const { groupId } = req.params;
    const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
    if (!group) return res.status(404).send('Group not found');

    const sessionKey = `member_${groupId}`;
    if (req.session[sessionKey]) {
      return res.redirect(`${req.app.locals.basePath}/g/${groupId}`);
    }

    if (group.status === 'closed') {
      return res.status(400).send('This group is closed.');
    }

    const members = db
      .prepare('SELECT * FROM members WHERE group_id = ? ORDER BY sort_order')
      .all(groupId);

    res.render('claim', {
      group,
      members,
      lineProfile: req.session.lineProfile,
      basePath: req.app.locals.basePath,
    });
  });

  // ── Claim a member slot ────────────────────────────────────────────────────
  router.post('/g/:groupId/claim', requireLineSSO, (req, res) => {
    const { groupId } = req.params;
    const { memberId } = req.body;
    const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
    if (!group) return res.status(404).send('Group not found');
    if (group.status === 'closed') return res.status(400).send('Group is closed');

    const member = db
      .prepare('SELECT * FROM members WHERE id = ? AND group_id = ?')
      .get(memberId, groupId);
    if (!member) return res.status(404).send('Member slot not found');
    if (member.line_user_id) return res.status(400).send('This name has already been claimed');

    const { userId, displayName, pictureUrl } = req.session.lineProfile;

    const existingClaim = db
      .prepare('SELECT * FROM members WHERE group_id = ? AND line_user_id = ?')
      .get(groupId, userId);
    if (existingClaim) {
      return res.status(400).send('You have already claimed a name in this group');
    }

    db.prepare(
      `UPDATE members
       SET line_user_id = ?, display_name = ?, line_picture_url = ?, claimed_at = ?
       WHERE id = ?`
    ).run(userId, displayName, pictureUrl || null, Date.now(), memberId);

    if (!group.admin_member_id) {
      db.prepare('UPDATE groups SET admin_member_id = ? WHERE id = ?').run(memberId, groupId);
    }

    req.session[`member_${groupId}`] = memberId;
    res.redirect(`${req.app.locals.basePath}/g/${groupId}`);
  });

  // ── My-groups login gate ───────────────────────────────────────────────────
  // The original groups.js redirected to LINE OAuth for /my-groups. Since
  // we no longer run OAuth ourselves, we just use the SSO middleware instead.
  // This route isn't strictly needed (groups.js still handles /my-groups) but
  // we expose a named route here so it can be added to the router in groups.js
  // without importing sso.js there.
  router.get('/login', (req, res) => {
    // Direct hit on /split-bill/login -> send to the real login page
    const next = req.query.next || req.app.locals.basePath + '/my-groups';
    const authBase = process.env.AUTH_SERVICE_BASE || '/auth';
    res.redirect(`${authBase}/login?next=${encodeURIComponent(next)}`);
  });

  // ── Logout ─────────────────────────────────────────────────────────────────
  router.post('/auth/logout', (req, res) => {
    // Destroy the local Express session. The shared auth cookie is managed
    // by /auth/logout.
    req.session.destroy(() => {
      res.redirect(req.app.locals.basePath + '/');
    });
  });
};
