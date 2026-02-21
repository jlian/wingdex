CREATE TABLE ai_daily_usage (
  userId TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  usageDate TEXT NOT NULL,
  requestCount INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (userId, endpoint, usageDate)
);

CREATE INDEX idx_ai_daily_usage_usageDate ON ai_daily_usage(usageDate);