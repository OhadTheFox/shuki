-- Round 21, after review: where a recipe came from, for the small line in the list ("מתכון מצילום מסך").
-- 'photo' = read from a screenshot or a photo; 'shuki' = one of Shuki's ideas. Links are known from url; typed ones from added_by.
ALTER TABLE recipes ADD COLUMN source TEXT;
