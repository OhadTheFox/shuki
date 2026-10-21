-- Security review (30/09). When a pairing code was made: while strangers hammer the pairing screen, a code the
-- admin made a few minutes ago still works (A-1).
ALTER TABLE pairing_codes ADD COLUMN created INTEGER;
-- What calls in flight may still cost, so parallel messages can't all pass the monthly cap check at once (A-5).
ALTER TABLE usage ADD COLUMN reserved INTEGER NOT NULL DEFAULT 0;
