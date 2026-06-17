// routes/auth.js
const lineAuth = require('../lib/line-auth');

function getDb() {
  if (process.env.USE_SANDBOX_DB === '1') {
    return require('../db/index.sandbox');
  }
  return require('../db');
}

module.exports = function (router) {
  const db = getDb();

  // --- Join page: entry point from the invite link ---
  router.get('/g/:groupId/join', (req, res) => {
    const { groupId } = req.params;
    const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
    if (!group) return res.status(404).send('Group not found');

    const sessionKey = `member_${groupId}`;
    if (req.session[sessionKey]) {
      // Already claimed a name in this group -> go straight to dashboard
      return res.redirect(`${req.app.locals.basePath}/g/${groupId}`);
    }

    if (!req.session.lineProfile) {
      // Not logged in via LINE yet -> kick off OAuth, remembering where to return
      const state = lineAuth.randomState();
      req.session.oauthState = state;
      req.session.postLoginRedirect = `${req.app.locals.basePath}/g/${groupId}/join`;
      const redirectUri = `${req.protocol}://${req.get('host')}${req.app.locals.basePath}/auth/line/callback`;
      return res.redirect(lineAuth.buildAuthUrl({ state, redirectUri }));
    }

    // Logged in via LINE, but haven't claimed a member slot in this group yet
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

  // --- Claim a member slot as the logged-in LINE user ---
  router.post('/g/:groupId/claim', (req, res) => {
    const { groupId } = req.params;
    const { memberId } = req.body;
    const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
    if (!group) return res.status(404).send('Group not found');
    if (group.status === 'closed') return res.status(400).send('Group is closed');

    if (!req.session.lineProfile) {
      return res.redirect(`${req.app.locals.basePath}/g/${groupId}/join`);
    }

    const member = db
      .prepare('SELECT * FROM members WHERE id = ? AND group_id = ?')
      .get(memberId, groupId);
    if (!member) return res.status(404).send('Member slot not found');
    if (member.line_user_id) return res.status(400).send('This name has already been claimed');

    const { userId, displayName, pictureUrl } = req.session.lineProfile;

    // Prevent the same LINE account from claiming two slots in one group
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

    // First person to ever claim becomes admin if no admin set yet
    if (!group.admin_member_id) {
      db.prepare('UPDATE groups SET admin_member_id = ? WHERE id = ?').run(memberId, groupId);
    }

    req.session[`member_${groupId}`] = memberId;
    res.redirect(`${req.app.locals.basePath}/g/${groupId}`);
  });

  // --- LINE OAuth callback ---
  router.get('/auth/line/callback', async (req, res) => {
    const { code, state, error } = req.query;

    if (error) {
      return res.status(400).send(`LINE login failed: ${error}`);
    }
    if (!state || state !== req.session.oauthState) {
      return res.status(400).send('Invalid login state. Please try again.');
    }

    try {
      const redirectUri = `${req.protocol}://${req.get('host')}${req.app.locals.basePath}/auth/line/callback`;
      const tokenData = await lineAuth.exchangeCodeForToken({ code, redirectUri });
      const profile = await lineAuth.getProfile(tokenData.access_token);

      req.session.lineProfile = {
        userId: profile.userId,
        displayName: profile.displayName,
        pictureUrl: profile.pictureUrl,
      };
      delete req.session.oauthState;

      const redirectTo = req.session.postLoginRedirect || req.app.locals.basePath + '/';
      delete req.session.postLoginRedirect;
      res.redirect(redirectTo);
    } catch (err) {
      console.error('LINE OAuth error:', err.response?.data || err.message);
      res.status(500).send('Login failed. Please try again.');
    }
  });

  // --- Logout (clears LINE session profile, not group membership) ---
  router.post('/auth/logout', (req, res) => {
    req.session.destroy(() => {
      res.redirect(req.app.locals.basePath + '/');
    });
  });
};
