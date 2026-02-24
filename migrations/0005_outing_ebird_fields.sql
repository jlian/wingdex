ALTER TABLE outing ADD COLUMN stateProvince TEXT;
ALTER TABLE outing ADD COLUMN countryCode TEXT;
ALTER TABLE outing ADD COLUMN protocol TEXT;
ALTER TABLE outing ADD COLUMN numberObservers INTEGER;
ALTER TABLE outing ADD COLUMN allObsReported INTEGER;
ALTER TABLE outing ADD COLUMN effortDistanceMiles REAL;
ALTER TABLE outing ADD COLUMN effortAreaAcres REAL;
ALTER TABLE observation ADD COLUMN speciesComments TEXT;
