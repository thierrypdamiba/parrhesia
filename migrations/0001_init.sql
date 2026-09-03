-- 0001_init: every table and index from docs/PLAN.md section 4.3.
-- Rules: every statement uses IF NOT EXISTS; statements are separated by ';'
-- and applied through env.DB.batch() (never exec()). Timestamps are ISO-8601 UTC.

CREATE TABLE IF NOT EXISTS _migrations (
  name TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS letters (
  id TEXT PRIMARY KEY,
  document_number TEXT,
  title TEXT,
  agency TEXT,
  agency_slug TEXT,
  docket_id TEXT,
  regs_document_id TEXT,
  comment_url TEXT,
  html_url TEXT,
  publication_date TEXT,
  comments_close_on TEXT,
  rule_sha256 TEXT,
  rev_no INTEGER NOT NULL DEFAULT 1,
  rev_hash TEXT NOT NULL,
  owner_user_id TEXT,
  owner_token_hash TEXT,
  share_code TEXT NOT NULL UNIQUE,
  public_token TEXT NOT NULL UNIQUE,
  is_judge_copy INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_letters_share_code ON letters (share_code);
CREATE INDEX IF NOT EXISTS idx_letters_public_token ON letters (public_token);
CREATE INDEX IF NOT EXISTS idx_letters_document_number ON letters (document_number);

CREATE TABLE IF NOT EXISTS rules_cache (
  document_number TEXT PRIMARY KEY,
  title TEXT,
  agency TEXT,
  comments_close_on TEXT,
  text TEXT NOT NULL,
  text_sha256 TEXT NOT NULL,
  first_page INTEGER NOT NULL,
  pages_json TEXT NOT NULL,
  breaks_json TEXT NOT NULL,
  toc_json TEXT NOT NULL,
  source_url TEXT,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('txt', 'xml', 'seed')),
  fetched_at TEXT NOT NULL,
  detail_json TEXT
);

CREATE TABLE IF NOT EXISTS fr_cache (
  key TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS claims (
  id TEXT PRIMARY KEY,
  letter_id TEXT NOT NULL,
  ord INTEGER NOT NULL,
  quote TEXT NOT NULL,
  anchor_start INTEGER,
  anchor_end INTEGER,
  page INTEGER,
  anchor_status TEXT NOT NULL CHECK (anchor_status IN ('anchored', 'unverified')),
  position TEXT NOT NULL CHECK (position IN ('support', 'oppose', 'modify')),
  assertion TEXT NOT NULL DEFAULT '',
  requested_change TEXT NOT NULL DEFAULT '',
  evidence TEXT NOT NULL DEFAULT '',
  proposed_by TEXT,
  accepted_by TEXT,
  accepted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_claims_letter_ord ON claims (letter_id, ord);

CREATE TABLE IF NOT EXISTS proposals (
  id TEXT PRIMARY KEY,
  letter_id TEXT NOT NULL,
  base_rev TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('claim', 'edit', 'impact')),
  claim_id TEXT,
  field TEXT,
  payload_json TEXT NOT NULL,
  diff_json TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected', 'stale')),
  proposed_by TEXT NOT NULL,
  proposed_for_user_id TEXT,
  decided_by TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_proposals_letter_status ON proposals (letter_id, status);
CREATE INDEX IF NOT EXISTS idx_proposals_letter_kind_for ON proposals (letter_id, kind, proposed_for_user_id);

CREATE TABLE IF NOT EXISTS signers (
  letter_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  impact_text TEXT,
  signed_at TEXT,
  added_at TEXT NOT NULL,
  PRIMARY KEY (letter_id, user_id)
);

CREATE TABLE IF NOT EXISTS revisions (
  letter_id TEXT NOT NULL,
  rev_no INTEGER NOT NULL,
  rev_hash TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (letter_id, rev_no)
);

CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  letter_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  kind TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_activity_letter ON activity (letter_id, id);

CREATE TABLE IF NOT EXISTS ratelimit (
  bucket TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0
);
