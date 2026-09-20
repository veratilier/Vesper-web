-- Keep legacy cursors for compatibility, but use these explicit cursors for
-- absence and natural settling from this version onward.
ALTER TABLE desire_state ADD COLUMN last_absence_evaluated_at TEXT;
ALTER TABLE desire_state ADD COLUMN last_intensity_evaluated_at TEXT;
ALTER TABLE desire_state ADD COLUMN last_settled_at TEXT;

UPDATE desire_state
SET last_absence_evaluated_at = longing_calculated_through_at
WHERE last_absence_evaluated_at IS NULL;

UPDATE desire_state
SET last_intensity_evaluated_at = possessiveness_calculated_through_at
WHERE last_intensity_evaluated_at IS NULL;

UPDATE desire_state
SET last_settled_at = COALESCE(last_encounter_at, updated_at)
WHERE last_settled_at IS NULL;

ALTER TABLE encounter_history ADD COLUMN event_at TEXT;
ALTER TABLE encounter_history ADD COLUMN interaction_source TEXT NOT NULL DEFAULT 'automation'
  CHECK (interaction_source IN ('user', 'automation', 'frontend'));
ALTER TABLE encounter_history ADD COLUMN change_reasons TEXT NOT NULL DEFAULT '{}';

UPDATE encounter_history
SET event_at = created_at
WHERE event_at IS NULL;
