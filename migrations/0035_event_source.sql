-- 16/10 (the owner): what the mapping and the first meeting add isn't counted for Shuki's levels. An event says where it came
-- from: 'mapping' (a card proposed while a place was being mapped), 'onboarding' (the first meeting), or NULL (anything
-- else, as every event before this). The events already there are not marked: which of them came from a mapping can't be
-- told for sure (docs/firstuse-report.md).
ALTER TABLE events ADD COLUMN source TEXT;
