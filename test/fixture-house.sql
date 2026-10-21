-- Tests: the house of the stories (Avi the admin, Michal), as if set up through the app.
INSERT OR IGNORE INTO users (id, name, gender, role, active, created) VALUES (1, 'אבי', 'm', 'admin', 1, 0), (2, 'מיכל', 'f', 'member', 1, 0);
INSERT OR IGNORE INTO settings (key, value) VALUES ('house_name', 'הבית של אבי ומיכל'), ('tz', 'Asia/Jerusalem');
