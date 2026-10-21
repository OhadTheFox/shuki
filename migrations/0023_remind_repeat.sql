-- r0t-7 (c4, the owner 04/10): a reminder that repeats every day ("תזכיר לי כל ערב להכין קופסאות"): after it goes out it moves to
-- the next day, until it's stopped (from the chat, or "כבר לא צריך").
ALTER TABLE maybe ADD COLUMN repeat TEXT;
