// lib/settlement.js
//
// Pure functions for computing balances and a minimal set of settlement
// transfers. No DB access here — easy to unit test in isolation.

/**
 * @param {Array<{id: string, paid_by_member_id: string, amount: number}>} expenses
 * @param {Array<{expense_id: string, member_id: string}>} participants
 * @param {Array<{id: string}>} members
 * @returns {Map<string, number>} member_id -> net balance (positive = owed money, negative = owes money)
 */
function calculateBalances(expenses, participants, members) {
  const balances = new Map(members.map(m => [m.id, 0]));

  // Group participants by expense
  const participantsByExpense = new Map();
  for (const p of participants) {
    if (!participantsByExpense.has(p.expense_id)) {
      participantsByExpense.set(p.expense_id, []);
    }
    participantsByExpense.get(p.expense_id).push(p.member_id);
  }

  for (const exp of expenses) {
    const involvedMemberIds = participantsByExpense.get(exp.id) || [];
    if (involvedMemberIds.length === 0) continue;

    // Split amount evenly across participants, in integer cents to avoid
    // floating point drift, then distribute any leftover cent(s) to the
    // first participants so the total reconciles exactly.
    const totalCents = Math.round(exp.amount * 100);
    const n = involvedMemberIds.length;
    const baseShare = Math.floor(totalCents / n);
    const remainder = totalCents - baseShare * n;

    involvedMemberIds.forEach((memberId, idx) => {
      const shareCents = baseShare + (idx < remainder ? 1 : 0);
      // This member "owes" shareCents toward this expense
      balances.set(memberId, (balances.get(memberId) || 0) - shareCents);
    });

    // The payer is credited the full amount they fronted
    balances.set(
      exp.paid_by_member_id,
      (balances.get(exp.paid_by_member_id) || 0) + totalCents
    );
  }

  // Convert back to currency units (2 decimal places)
  const result = new Map();
  for (const [memberId, cents] of balances) {
    result.set(memberId, cents / 100);
  }
  return result;
}

/**
 * Greedy minimal-transaction settlement: repeatedly match the largest debtor
 * with the largest creditor. Produces a near-minimal number of transfers
 * (optimal minimal-transaction-count is NP-hard in general, but greedy
 * largest-first is the standard practical approach used by tools like
 * Splitwise and is provably good enough for typical small groups).
 *
 * @param {Map<string, number>} balances member_id -> net balance in currency units
 * @returns {Array<{from: string, to: string, amount: number}>}
 */
function computeMinimalTransfers(balances) {
  const CENTS_EPSILON = 1; // 1 cent tolerance for float rounding

  const creditors = [];
  const debtors = [];

  for (const [memberId, balance] of balances) {
    const cents = Math.round(balance * 100);
    if (cents > CENTS_EPSILON) {
      creditors.push({ memberId, cents });
    } else if (cents < -CENTS_EPSILON) {
      debtors.push({ memberId, cents: -cents }); // store as positive "owes" amount
    }
  }

  creditors.sort((a, b) => b.cents - a.cents);
  debtors.sort((a, b) => b.cents - a.cents);

  const transfers = [];
  let i = 0, j = 0;

  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i];
    const creditor = creditors[j];
    const transferCents = Math.min(debtor.cents, creditor.cents);

    if (transferCents > CENTS_EPSILON) {
      transfers.push({
        from: debtor.memberId,
        to: creditor.memberId,
        amount: transferCents / 100
      });
    }

    debtor.cents -= transferCents;
    creditor.cents -= transferCents;

    if (debtor.cents <= CENTS_EPSILON) i++;
    if (creditor.cents <= CENTS_EPSILON) j++;
  }

  return transfers;
}

module.exports = { calculateBalances, computeMinimalTransfers };
