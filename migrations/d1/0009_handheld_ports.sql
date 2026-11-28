CREATE TABLE handheld_ports (
  handheld TEXT PRIMARY KEY NOT NULL,
  progress TEXT NOT NULL CHECK (progress IN ('inProgress', 'testing'))
);
