-- Split Bill App Schema

CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,              -- nanoid, used in URLs
  name TEXT NOT NULL,
  join_code TEXT UNIQUE NOT NULL,   -- short code for invite link
  admin_member_id TEXT,             -- set once admin claims their slot
  status TEXT NOT NULL DEFAULT 'open',  -- 'open' | 'closed'
  currency TEXT NOT NULL DEFAULT 'TWD',
  created_at INTEGER NOT NULL,
  closed_at INTEGER
);

CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,              -- nanoid
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,       -- placeholder name, or LINE display name once claimed
  line_user_id TEXT,                -- NULL until claimed
  line_picture_url TEXT,
  is_admin INTEGER NOT NULL DEFAULT 0,
  claimed_at INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE(group_id, line_user_id)
);

CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,              -- nanoid
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  amount REAL NOT NULL,
  paid_by_member_id TEXT NOT NULL REFERENCES members(id),
  created_by_member_id TEXT,        -- who entered it (may differ from payer)
  split_mode TEXT NOT NULL DEFAULT 'all',  -- 'all' | 'custom'
  created_at INTEGER NOT NULL
);

-- Which members an expense applies to (used for both 'all' and 'custom' modes,
-- so the split logic doesn't need to special-case anything)
CREATE TABLE IF NOT EXISTS expense_participants (
  expense_id TEXT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  PRIMARY KEY (expense_id, member_id)
);

-- Snapshot of a calculated settlement (so history isn't lost if new expenses get added later)
CREATE TABLE IF NOT EXISTS settlements (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settlement_transfers (
  id TEXT PRIMARY KEY,
  settlement_id TEXT NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
  from_member_id TEXT NOT NULL REFERENCES members(id),
  to_member_id TEXT NOT NULL REFERENCES members(id),
  amount REAL NOT NULL,
  is_paid INTEGER NOT NULL DEFAULT 0,
  paid_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_members_group ON members(group_id);
CREATE INDEX IF NOT EXISTS idx_expenses_group ON expenses(group_id);
CREATE INDEX IF NOT EXISTS idx_expense_participants_expense ON expense_participants(expense_id);
CREATE INDEX IF NOT EXISTS idx_settlement_transfers_settlement ON settlement_transfers(settlement_id);
