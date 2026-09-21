CREATE TABLE IF NOT EXISTS desire_state (
  user_id TEXT PRIMARY KEY,
  style TEXT NOT NULL CHECK (style IN ('quiet', 'playful', 'clingy')),
  longing INTEGER NOT NULL CHECK (longing BETWEEN 0 AND 100),
  tenderness INTEGER NOT NULL CHECK (tenderness BETWEEN 0 AND 100),
  playfulness INTEGER NOT NULL CHECK (playfulness BETWEEN 0 AND 100),
  intensity INTEGER NOT NULL CHECK (intensity BETWEEN 0 AND 100),
  attachment INTEGER NOT NULL CHECK (attachment BETWEEN 0 AND 100),
  possessiveness INTEGER NOT NULL CHECK (possessiveness BETWEEN 0 AND 100),
  last_encounter_at TEXT,
  last_expression_at TEXT,
  last_real_interaction_at TEXT,
  longing_calculated_through_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS encounter_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('warmth', 'absence', 'repair', 'shared_work', 'flirt')),
  surface TEXT NOT NULL CHECK (surface IN ('chat', 'frontend')),
  note TEXT NOT NULL,
  created_at TEXT NOT NULL,
  before_state TEXT NOT NULL,
  after_state TEXT NOT NULL,
  delta TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS encounter_history_user_time
  ON encounter_history (user_id, created_at DESC, id DESC);
