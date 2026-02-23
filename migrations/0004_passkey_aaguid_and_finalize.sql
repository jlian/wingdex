ALTER TABLE passkey
ADD COLUMN aaguid TEXT;

UPDATE "user"
SET isAnonymous = 0
WHERE id IN (
  SELECT DISTINCT userId
  FROM passkey
);
