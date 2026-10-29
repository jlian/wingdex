-- Better Auth 1.7.14 identifies accounts by (providerId, accountId).
CREATE TABLE account_new (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  accountId TEXT NOT NULL,
  providerId TEXT NOT NULL,
  accessToken TEXT,
  refreshToken TEXT,
  accessTokenExpiresAt TEXT,
  refreshTokenExpiresAt TEXT,
  scope TEXT,
  idToken TEXT,
  password TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Dropping a parent table fires ON DELETE CASCADE in D1. Preserve native Apple
-- revocation credentials outside that foreign-key graph during the rebuild.
CREATE TABLE account_provider_apple_credential_backup AS
SELECT authAccountId, accessToken, refreshToken, updatedAt
FROM apple_native_revocation_credential;

INSERT INTO account_new (
  id, userId, accountId, providerId,
  accessToken, refreshToken, accessTokenExpiresAt, refreshTokenExpiresAt,
  scope, idToken, password, createdAt, updatedAt
)
SELECT
  id, userId, accountId, providerId,
  accessToken, refreshToken, accessTokenExpiresAt, refreshTokenExpiresAt,
  scope, idToken, password, createdAt, updatedAt
FROM account;

CREATE UNIQUE INDEX account_providerId_accountId_uidx
ON account_new(providerId, accountId);

DROP TABLE account;
ALTER TABLE account_new RENAME TO account;

CREATE INDEX idx_account_userId ON account(userId);

INSERT INTO apple_native_revocation_credential (
  authAccountId, accessToken, refreshToken, updatedAt
)
SELECT authAccountId, accessToken, refreshToken, updatedAt
FROM account_provider_apple_credential_backup;

DROP TABLE account_provider_apple_credential_backup;
