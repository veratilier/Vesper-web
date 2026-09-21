export const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS vesper_documents (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_vesper_documents_updated_at
   ON vesper_documents(updated_at)`,
  `CREATE TABLE IF NOT EXISTS vesper_chat_messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('user', 'agent', 'system')),
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    delivered_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_vesper_chat_conversation
   ON vesper_chat_messages(conversation_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_vesper_chat_delivery
   ON vesper_chat_messages(role, status, created_at)`,
  `CREATE TABLE IF NOT EXISTS vesper_bridge_status (
    id TEXT PRIMARY KEY,
    runtime TEXT NOT NULL DEFAULT 'cyberboss',
    last_seen_at TEXT NOT NULL,
    details TEXT NOT NULL DEFAULT '{}'
  )`,
  `CREATE TABLE IF NOT EXISTS vesper_push_subscriptions (
    endpoint TEXT PRIMARY KEY,
    subscription TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS vesper_memories (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    character_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('core', 'long_term', 'feeling', 'dream')),
    body TEXT NOT NULL,
    mood TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '[]',
    weight REAL NOT NULL DEFAULT 0.65,
    pinned INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL,
    review_status TEXT NOT NULL DEFAULT 'approved' CHECK(review_status IN ('approved', 'candidate')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_surfaced_at TEXT,
    surface_count INTEGER NOT NULL DEFAULT 0,
    embedding TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    demoted_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_vesper_memories_scope
   ON vesper_memories(user_id, character_id, type, pinned, updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_vesper_memories_fingerprint
   ON vesper_memories(user_id, character_id, fingerprint)`,
  `CREATE TABLE IF NOT EXISTS vesper_memory_revisions (
    id TEXT PRIMARY KEY,
    memory_id TEXT NOT NULL,
    body TEXT NOT NULL,
    mood TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '[]',
    reason TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(memory_id) REFERENCES vesper_memories(id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_vesper_memory_revisions_memory
   ON vesper_memory_revisions(memory_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS vesper_memory_messages (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    character_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    turn_id TEXT,
    role TEXT NOT NULL CHECK(role IN ('user', 'agent')),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(user_id, character_id, conversation_id, message_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_vesper_memory_messages_window
   ON vesper_memory_messages(user_id, character_id, conversation_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS vesper_memory_jobs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    character_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    dedupe_key TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('queued', 'retry', 'completed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT NOT NULL,
    last_error TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(user_id, character_id, dedupe_key)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_vesper_memory_jobs_due
   ON vesper_memory_jobs(user_id, character_id, status, next_attempt_at)`,
  `CREATE TABLE IF NOT EXISTS vesper_mcp_connections (
    id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    auth_mode TEXT NOT NULL CHECK(auth_mode IN ('none', 'oauth', 'bearer')),
    token_ciphertext TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    tool_catalog TEXT NOT NULL DEFAULT '[]',
    last_tested_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_vesper_mcp_connections_scope
   ON vesper_mcp_connections(user_id, enabled, updated_at DESC)`,
  `CREATE TABLE IF NOT EXISTS vesper_sticker_categories (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    character_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(user_id, character_id, name)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_vesper_sticker_categories_scope
   ON vesper_sticker_categories(user_id, character_id, sort_order, name)`,
  `CREATE TABLE IF NOT EXISTS vesper_sticker_assets (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    character_id TEXT NOT NULL,
    r2_key TEXT NOT NULL,
    url TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    mime_type TEXT NOT NULL,
    file_name TEXT NOT NULL,
    category_id TEXT,
    description TEXT NOT NULL DEFAULT '',
    favorite INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'upload',
    source_conversation_id TEXT,
    source_message_id TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'needs_review', 'deleting', 'deleted')),
    last_used_at TEXT,
    use_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    UNIQUE(user_id, character_id, sha256),
    FOREIGN KEY(category_id) REFERENCES vesper_sticker_categories(id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_vesper_sticker_assets_scope
   ON vesper_sticker_assets(user_id, character_id, status, favorite, last_used_at DESC, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS vesper_sticker_collect_settings (
    user_id TEXT NOT NULL,
    character_id TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0,
    max_per_day INTEGER NOT NULL DEFAULT 8,
    cooldown_seconds INTEGER NOT NULL DEFAULT 120,
    min_confidence REAL NOT NULL DEFAULT 0.88,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(user_id, character_id)
  )`,
  `CREATE TABLE IF NOT EXISTS vesper_sticker_collection_jobs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    character_id TEXT NOT NULL,
    source_attachment_key TEXT NOT NULL,
    source_message_id TEXT NOT NULL,
    source_conversation_id TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('queued', 'retry', 'completed', 'ignored', 'failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT NOT NULL,
    decision_json TEXT NOT NULL DEFAULT '{}',
    last_error TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(user_id, character_id, source_attachment_key, sha256)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_vesper_sticker_jobs_due
   ON vesper_sticker_collection_jobs(user_id, character_id, status, next_attempt_at)`,
  `CREATE TABLE IF NOT EXISTS vesper_sticker_agent_usage (
    user_id TEXT NOT NULL,
    character_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    last_turn_id TEXT NOT NULL DEFAULT '',
    last_sent_at TEXT NOT NULL,
    sent_count INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(user_id, character_id, conversation_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_vesper_sticker_agent_usage_recent
   ON vesper_sticker_agent_usage(user_id, character_id, last_sent_at DESC)`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS vesper_memory_fts USING fts5(
    memory_id UNINDEXED,
    body,
    tags
  )`,
];

export const allowedDocumentKeys = new Set([
  "readingRoom",
  "profile",
  "appearance",
  "notes",
  "todos",
  "anniversaries",
  "diary",
  "conversations",
  "settings",
  "environment",
  "music",
  "musicQueue",
  "musicControl",
  "musicPlayback",
  "musicTogether",
  "musicAnnotations",
  "musicFavorites",
  "magicBox",
  "connections",
  "externalMemory",
  "favorites",
]);
