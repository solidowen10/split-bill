// routes/expenses.js
const { nanoid } = require('nanoid');

function getDb() {
  if (process.env.USE_SANDBOX_DB === '1') {
    return require('../db/index.sandbox');
  }
  return require('../db');
}

module.exports = function (router) {
  const db = getDb();

  router.post('/g/:groupId/expenses', (req, res) => {
    const { groupId } = req.params;
    const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
    if (!group) return res.status(404).send('Group not found');
    if (group.status === 'closed') return res.status(400).send('Group is closed');

    const sessionKey = `member_${groupId}`;
    const currentMemberId = req.session[sessionKey];
    if (!currentMemberId) {
      return res.status(403).send('You must claim your name in this group first');
    }

    const { description, amount, paidBy, splitMode } = req.body;
    let participantIds = req.body.participantIds;

    if (!description || !description.trim()) {
      return res.status(400).send('Description is required');
    }
    const amountNum = parseFloat(amount);
    if (!amountNum || amountNum <= 0) {
      return res.status(400).send('Amount must be a positive number');
    }
    const payer = db
      .prepare('SELECT * FROM members WHERE id = ? AND group_id = ?')
      .get(paidBy, groupId);
    if (!payer) {
      return res.status(400).send('Invalid payer');
    }

    // Normalize participantIds to an array (HTML checkboxes may send a single string)
    if (!participantIds) {
      participantIds = [];
    } else if (!Array.isArray(participantIds)) {
      participantIds = [participantIds];
    }

    const mode = splitMode === 'custom' ? 'custom' : 'all';

    let finalParticipantIds = participantIds;
    if (mode === 'all') {
      const allMembers = db.prepare('SELECT id FROM members WHERE group_id = ?').all(groupId);
      finalParticipantIds = allMembers.map((m) => m.id);
    }

    if (finalParticipantIds.length === 0) {
      return res.status(400).send('At least one participant must be selected');
    }

    const expenseId = nanoid(10);
    const now = Date.now();

    db.prepare(
      `INSERT INTO expenses
       (id, group_id, description, amount, paid_by_member_id, created_by_member_id, split_mode, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(expenseId, groupId, description.trim(), amountNum, paidBy, currentMemberId, mode, now);

    const insertParticipant = db.prepare(
      'INSERT INTO expense_participants (expense_id, member_id) VALUES (?, ?)'
    );
    for (const memberId of finalParticipantIds) {
      insertParticipant.run(expenseId, memberId);
    }

    res.redirect(`${req.app.locals.basePath}/g/${groupId}`);
  });

  router.post('/g/:groupId/expenses/:expenseId/delete', (req, res) => {
    const { groupId, expenseId } = req.params;
    const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
    if (!group) return res.status(404).send('Group not found');
    if (group.status === 'closed') return res.status(400).send('Group is closed');

    const sessionKey = `member_${groupId}`;
    const currentMemberId = req.session[sessionKey];
    const expense = db
      .prepare('SELECT * FROM expenses WHERE id = ? AND group_id = ?')
      .get(expenseId, groupId);
    if (!expense) return res.status(404).send('Expense not found');

    const isAdmin = group.admin_member_id === currentMemberId;
    const isCreator = expense.created_by_member_id === currentMemberId;
    const isPayer = expense.paid_by_member_id === currentMemberId;

    if (!isAdmin && !isCreator && !isPayer) {
      return res.status(403).send('You can only delete expenses you added or paid for');
    }

    db.prepare('DELETE FROM expenses WHERE id = ?').run(expenseId);
    res.redirect(`${req.app.locals.basePath}/g/${groupId}`);
  });
};
