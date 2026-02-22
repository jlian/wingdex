CREATE TABLE "user" (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  emailVerified INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE session (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expiresAt TEXT NOT NULL,
  ipAddress TEXT,
  userAgent TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE account (
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

CREATE TABLE verification (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expiresAt TEXT NOT NULL,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE passkey (
  id TEXT PRIMARY KEY,
  name TEXT,
  publicKey TEXT NOT NULL,
  userId TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  credentialID TEXT NOT NULL UNIQUE,
  counter INTEGER NOT NULL DEFAULT 0,
  deviceType TEXT,
  backedUp INTEGER NOT NULL DEFAULT 0,
  transports TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE outing (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  startTime TEXT NOT NULL,
  endTime TEXT NOT NULL,
  locationName TEXT NOT NULL,
  defaultLocationName TEXT,
  lat REAL,
  lon REAL,
  notes TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE photo (
  id TEXT PRIMARY KEY,
  outingId TEXT NOT NULL REFERENCES outing(id) ON DELETE CASCADE,
  userId TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  dataUrl TEXT NOT NULL DEFAULT '',
  thumbnail TEXT NOT NULL DEFAULT '',
  exifTime TEXT,
  gpsLat REAL,
  gpsLon REAL,
  fileHash TEXT NOT NULL,
  fileName TEXT NOT NULL
);

CREATE TABLE observation (
  id TEXT PRIMARY KEY,
  outingId TEXT NOT NULL REFERENCES outing(id) ON DELETE CASCADE,
  userId TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  speciesName TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  certainty TEXT NOT NULL DEFAULT 'pending'
    CHECK(certainty IN ('confirmed','possible','pending','rejected')),
  representativePhotoId TEXT REFERENCES photo(id) ON DELETE SET NULL,
  aiConfidence REAL,
  notes TEXT NOT NULL DEFAULT ''
);

CREATE TABLE dex_meta (
  userId TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  speciesName TEXT NOT NULL,
  addedDate TEXT,
  bestPhotoId TEXT REFERENCES photo(id) ON DELETE SET NULL,
  notes TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (userId, speciesName)
);

CREATE INDEX idx_outing_userId ON outing(userId);
CREATE INDEX idx_photo_outingId ON photo(outingId);
CREATE INDEX idx_photo_userId ON photo(userId);
CREATE INDEX idx_observation_outingId ON observation(outingId);
CREATE INDEX idx_observation_userId ON observation(userId);
CREATE INDEX idx_observation_species ON observation(speciesName, userId);
CREATE INDEX idx_dex_meta_userId ON dex_meta(userId);
CREATE INDEX idx_session_token ON session(token);
CREATE INDEX idx_account_userId ON account(userId);
