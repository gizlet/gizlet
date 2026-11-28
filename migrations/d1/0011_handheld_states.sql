CREATE TABLE handheld_states (
  handheld TEXT PRIMARY KEY NOT NULL,
  progress TEXT NOT NULL CHECK (progress IN ('developing', 'voting', 'unpicked')),
  estimated_release_date TEXT CHECK (progress = 'developing' OR estimated_release_date IS NULL)
);
INSERT INTO handheld_states (handheld, progress, estimated_release_date)
SELECT handheld, 'developing', estimated_release_date FROM handheld_ports;
DROP TABLE handheld_ports;
ALTER TABLE handheld_states RENAME TO handheld_ports;
