CREATE TABLE IF NOT EXISTS nodes (
  id                TEXT PRIMARY KEY,
  namespace         TEXT NOT NULL,
  title             TEXT,
  content           TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'stale', 'compacted')),
  source_type       TEXT NOT NULL DEFAULT 'capture' CHECK(source_type IN ('capture', 'compaction')),
  tags              TEXT,
  embedding         BLOB,
  embedding_pending INTEGER NOT NULL DEFAULT 0,
  compacted_into    TEXT REFERENCES nodes(id),
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  stale_at          TEXT,
  session_id        TEXT
);

CREATE INDEX IF NOT EXISTS idx_nodes_namespace ON nodes(namespace);
CREATE INDEX IF NOT EXISTS idx_nodes_status ON nodes(status);
CREATE INDEX IF NOT EXISTS idx_nodes_updated ON nodes(updated_at);

CREATE TABLE IF NOT EXISTS links (
  id          TEXT PRIMARY KEY,
  source_id   TEXT NOT NULL REFERENCES nodes(id),
  target_id   TEXT NOT NULL REFERENCES nodes(id),
  link_type   TEXT NOT NULL CHECK(link_type IN ('supersedes', 'contradicts', 'related')),
  context     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_links_source ON links(source_id);
CREATE INDEX IF NOT EXISTS idx_links_target ON links(target_id);

CREATE TABLE IF NOT EXISTS namespaces (
  slug        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS project_mappings (
  directory_pattern TEXT PRIMARY KEY,
  namespace         TEXT NOT NULL REFERENCES namespaces(slug)
);

CREATE VIRTUAL TABLE IF NOT EXISTS node_embeddings USING vec0(
  node_id TEXT PRIMARY KEY,
  embedding FLOAT[768]
);

CREATE TABLE IF NOT EXISTS digests (
  namespace    TEXT PRIMARY KEY,
  content      TEXT NOT NULL,
  generated_at TEXT NOT NULL DEFAULT (datetime('now')),
  node_hash    TEXT NOT NULL,
  days         INTEGER NOT NULL
);
