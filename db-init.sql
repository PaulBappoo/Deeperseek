PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  content TEXT NOT NULL,
  role TEXT CHECK(role IN ('user', 'assistant')) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sub_messages (
  id TEXT PRIMARY KEY,
  parent_message_id TEXT NOT NULL,
  content TEXT NOT NULL,
  role TEXT CHECK(role IN ('user', 'assistant')) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(parent_message_id) REFERENCES messages(id) ON DELETE CASCADE
);

CREATE INDEX idx_conversation ON messages(conversation_id);
CREATE INDEX idx_parent_message ON sub_messages(parent_message_id);