// routes/settlements.js
const { nanoid } = require('nanoid');
const { calculateBalances, computeMinimalTransfers } = require('../lib/settlement');

function getDb() {
  if (process.env.USE_SANDBOX_DB === '1') {
    return require('../db/index.sandbox');
  }
  return require('../db');
}

module.exports = function (router) {
  const db = getDb();

  // --- Admin: calculate / recalculate the settlement ---
  router.post('/g/:groupId/calculate', (req, res) => {
    const { groupId } = req.params;
    const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
    if (!group) return res.status(404).send('Group not found');

    const sessionKey = `member_${groupId}`;
    const currentMemberId = req.session[sessionKey];
    if (group.admin_member_id !== currentMemberId) {
      return res.status(403).send('Only the group admin can calculate the split');
    }

    const members = db.prepare('SELECT * FROM members WHERE group_id = ?').all(groupId);
    const expenses = db.prepare('SELECT * FROM expenses WHERE group_id = ?').all(groupId);

    if (expenses.length === 0) {
      return res.status(400).send('No expenses to split yet');
    }

    const expenseIds = expenses.map((e) => e.id);
    const participants = [];
    if (expenseIds.length > 0) {
      const placeholders = expenseIds.map(() => '?').join(',');
      const rows = db
        .prepare(
          `SELECT expense_id, member_id FROM expense_participants WHERE expense_id IN (${placeholders})`
        )
        .all(...expenseIds);
      participants.push(...rows);
    }

    const balances = calculateBalances(expenses, participants, members);
    const transfers = computeMinimalTransfers(balances);

    const settlementId = nanoid(10);
    const now = Date.now();

    db.prepare('INSERT INTO settlements (id, group_id, created_at) VALUES (?, ?, ?)').run(
      settlementId,
      groupId,
      now
    );

    const insertTransfer = db.prepare(
      `INSERT INTO settlement_transfers (id, settlement_id, from_member_id, to_member_id, amount, is_paid)
       VALUES (?, ?, ?, ?, ?, 0)`
    );
    for (const t of transfers) {
      insertTransfer.run(nanoid(10), settlementId, t.from, t.to, t.amount);
    }

    res.redirect(`${req.app.locals.basePath}/g/${groupId}`);
  });

  // --- Mark a transfer as paid/unpaid ---
  // Either party in the transfer (the payer or the receiver) can toggle this.
  router.post('/g/:groupId/transfers/:transferId/toggle-paid', (req, res) => {
    const { groupId, transferId } = req.params;
    const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
    if (!group) return res.status(404).send('Group not found');

    const sessionKey = `member_${groupId}`;
    const currentMemberId = req.session[sessionKey];

    const transfer = db
      .prepare(
        `SELECT st.* FROM settlement_transfers st
         JOIN settlements s ON s.id = st.settlement_id
         WHERE st.id = ? AND s.group_id = ?`
      )
      .get(transferId, groupId);
    if (!transfer) return res.status(404).send('Transfer not found');

    const isInvolved =
      transfer.from_member_id === currentMemberId || transfer.to_member_id === currentMemberId;
    const isAdmin = group.admin_member_id === currentMemberId;

    if (!isInvolved && !isAdmin) {
      return res.status(403).send('Only the people in this transfer (or the admin) can mark it paid');
    }

    const newPaidState = transfer.is_paid ? 0 : 1;
    db.prepare(
      `UPDATE settlement_transfers SET is_paid = ?, paid_at = ? WHERE id = ?`
    ).run(newPaidState, newPaidState ? Date.now() : null, transferId);

    res.redirect(`${req.app.locals.basePath}/g/${groupId}`);
  });
};
