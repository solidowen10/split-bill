// routes/groups.js
const { nanoid } = require('nanoid');
const db = getDb();
const lineAuth = require('../lib/line-auth');

function getDb() {
  // Use sandbox driver only when explicitly testing locally without
  // better-sqlite3 compiled. Production always uses db/index.js.
  if (process.env.USE_SANDBOX_DB === '1') {
    return require('../db/index.sandbox');
  }
  return require('../db');
}

function genJoinCode() {
  // Short, human-typeable code (e.g. for manual entry as backup to the link)
  return nanoid(8).toUpperCase().replace(/[-_]/g, 'X');
}

module.exports = function (router) {
  // --- Landing page ---
  router.get('/', (req, res) => {
    res.render('landing');
  });
  // --- My Groups ---

  router.get('/my-groups', (req, res) => {
    if (!req.session.lineProfile) {
      req.session.postLoginRedirect = `${req.app.locals.basePath}/my-groups`;
      const state = lineAuth.randomState();
      req.session.oauthState = state;
      const redirectUri = `${req.protocol}://${req.get('host')}${req.app.locals.basePath}/auth/line/callback`;
      return res.redirect(lineAuth.buildAuthUrl({ state, redirectUri }));
    }

    const lineUserId = req.session.lineProfile.userId;
    const myGroups = db.prepare(
      `SELECT g.*, m.id as member_id, m.display_name, (g.admin_member_id = m.id) as is_admin
       FROM members m
       JOIN groups g ON g.id = m.group_id
       WHERE m.line_user_id = ?
       ORDER BY g.created_at DESC`
    ).all(lineUserId);

    res.render('my-groups', { myGroups, basePath: req.app.locals.basePath });
  });

  // --- Create a new group ---
  router.post('/groups', (req, res) => {
    const { groupName, currency } = req.body;
    if (!groupName || !groupName.trim()) {
      return res.status(400).send('Group name is required');
    }

    const groupId = nanoid(10);
    const joinCode = genJoinCode();
    const now = Date.now();

    db.prepare(
      `INSERT INTO groups (id, name, join_code, status, currency, created_at)
       VALUES (?, ?, ?, 'open', ?, ?)`
    ).run(groupId, groupName.trim(), joinCode, currency || 'TWD', now);

    // Store "creator" in session so they can claim the admin slot during setup
    req.session.pendingAdminGroupId = groupId;

    res.redirect(`${req.app.locals.basePath}/g/${groupId}/setup`);
  });

  // --- Admin setup: add placeholder member names ---
  router.get('/g/:groupId/setup', (req, res) => {
    const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.groupId);
    if (!group) return res.status(404).send('Group not found');

    const members = db
      .prepare('SELECT * FROM members WHERE group_id = ? ORDER BY sort_order')
      .all(group.id);

    res.render('setup', { group, members, basePath: req.app.locals.basePath });
  });

  router.post('/g/:groupId/members', (req, res) => {
    const { groupId } = req.params;
    const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
    if (!group) return res.status(404).send('Group not found');
    if (group.status === 'closed') return res.status(400).send('Group is closed');

    const { displayName } = req.body;
    if (!displayName || !displayName.trim()) {
      return res.status(400).send('Name is required');
    }

    const maxOrder = db
      .prepare('SELECT COALESCE(MAX(sort_order), -1) as m FROM members WHERE group_id = ?')
      .get(groupId).m;

    const memberId = nanoid(10);
    db.prepare(
      `INSERT INTO members (id, group_id, display_name, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(memberId, groupId, displayName.trim(), maxOrder + 1, Date.now());

    res.redirect(`${req.app.locals.basePath}/g/${groupId}/setup`);
  });

  router.post('/g/:groupId/members/:memberId/delete', (req, res) => {
    const { groupId, memberId } = req.params;
    const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
    if (!group) return res.status(404).send('Group not found');
    if (group.status === 'closed') return res.status(400).send('Group is closed');

    db.prepare('DELETE FROM members WHERE id = ? AND group_id = ?').run(memberId, groupId);
    res.redirect(`${req.app.locals.basePath}/g/${groupId}/setup`);
  });

  // Finish setup -> generates the invite link page
  router.post('/g/:groupId/setup/finish', (req, res) => {
    res.redirect(`${req.app.locals.basePath}/g/${req.params.groupId}/invite`);
  });

  router.get('/g/:groupId/invite', (req, res) => {
    const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.groupId);
    if (!group) return res.status(404).send('Group not found');
    const members = db
      .prepare('SELECT * FROM members WHERE group_id = ? ORDER BY sort_order')
      .all(group.id);

    const publicBaseUrl = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}${req.app.locals.basePath}`;
    const inviteUrl = `${publicBaseUrl}/g/${group.id}/join`;
    res.render('invite', { group, members, inviteUrl, basePath: req.app.locals.basePath });
  });

  // --- Main group dashboard ---
  router.get('/g/:groupId', (req, res) => {
    const { groupId } = req.params;
    const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
    if (!group) return res.status(404).send('Group not found');

    const members = db
      .prepare('SELECT * FROM members WHERE group_id = ? ORDER BY sort_order')
      .all(groupId);

    const expenses = db
      .prepare(
        `SELECT e.*, m.display_name as payer_name
         FROM expenses e
         JOIN members m ON m.id = e.paid_by_member_id
         WHERE e.group_id = ?
         ORDER BY e.created_at DESC`
      )
      .all(groupId);

    // Attach participant lists to each expense
    for (const exp of expenses) {
      exp.participantIds = db
        .prepare('SELECT member_id FROM expense_participants WHERE expense_id = ?')
        .all(exp.id)
        .map((r) => r.member_id);
    }

    const totalSpent = expenses.reduce((sum, e) => sum + e.amount, 0);

    // Identify current viewer. Prefer LINE user ID and fall back to session memberId.
    let currentMember = null;

    if (req.session.lineProfile) {
      currentMember = members.find((m) => m.line_user_id === req.session.lineProfile.userId) || null;
    }

    if (!currentMember) {
      const sessionKey = `member_${groupId}`;
      const currentMemberId = req.session[sessionKey] || null;
      currentMember = currentMemberId ? members.find((m) => m.id === currentMemberId) || null : null;
    }

    if (currentMember) {
      req.session[`member_${groupId}`] = currentMember.id;
    }

    const isAdmin = currentMember && group.admin_member_id === currentMember.id;

    // Latest settlement, if any
    const latestSettlement = db
      .prepare('SELECT * FROM settlements WHERE group_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(groupId);

    let transfers = [];
    if (latestSettlement) {
      transfers = db
        .prepare(
          `SELECT st.*, fm.display_name as from_name, tm.display_name as to_name
           FROM settlement_transfers st
           JOIN members fm ON fm.id = st.from_member_id
           JOIN members tm ON tm.id = st.to_member_id
           WHERE st.settlement_id = ?
           ORDER BY st.amount DESC`
        )
        .all(latestSettlement.id);
    }

    const unclaimedMembers = members.filter((m) => !m.line_user_id);
    const allClaimed = unclaimedMembers.length === 0 && members.length > 0;

    res.render('dashboard', {
      group,
      members,
      expenses,
      totalSpent,
      currentMember,
      isAdmin,
      latestSettlement,
      transfers,
      allClaimed,
      basePath: req.app.locals.basePath,
    });
  });

  // --- Admin: close group ---
  router.post('/g/:groupId/close', (req, res) => {
    const { groupId } = req.params;
    requireAdmin(req, db, groupId);
    db.prepare(`UPDATE groups SET status = 'closed', closed_at = ? WHERE id = ?`).run(
      Date.now(),
      groupId
    );
    res.redirect(`${req.app.locals.basePath}/g/${groupId}`);
  });

  // --- Admin: reopen group ---
  router.post('/g/:groupId/reopen', (req, res) => {
    const { groupId } = req.params;
    requireAdmin(req, db, groupId);
    db.prepare(`UPDATE groups SET status = 'open', closed_at = NULL WHERE id = ?`).run(groupId);
    res.redirect(`${req.app.locals.basePath}/g/${groupId}`);
  });

  // --- Admin: reset entries (keep members, wipe expenses/settlements) ---
  router.post('/g/:groupId/reset', (req, res) => {
    const { groupId } = req.params;
    requireAdmin(req, db, groupId);

    db.prepare('DELETE FROM expenses WHERE group_id = ?').run(groupId);
    db.prepare('DELETE FROM settlements WHERE group_id = ?').run(groupId);
    // expense_participants and settlement_transfers cascade-delete via FK

    res.redirect(`${req.app.locals.basePath}/g/${groupId}`);
  });
  // --- Admin: permanently delete the group ---
  router.post('/g/:groupId/delete', (req, res) => {
    const { groupId } = req.params;
    requireAdmin(req, db, groupId);

    db.prepare('DELETE FROM groups WHERE id = ?').run(groupId);

    res.redirect(`${req.app.locals.basePath}/my-groups`);
  });
};

function requireAdmin(req, db, groupId) {
  const sessionKey = `member_${groupId}`;
  const currentMemberId = req.session[sessionKey];
  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
  if (!group || group.admin_member_id !== currentMemberId) {
    const err = new Error('Forbidden: admin only');
    err.status = 403;
    throw err;
  }
}
