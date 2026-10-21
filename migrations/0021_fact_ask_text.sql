-- r0t-2 (the owner 03/10, (א)): with ask_again, the model also writes the question itself, in the second person to whoever is
-- asked ("רשמתי שאת צמחונית. האם זה עדיין נכון?"), and the server asks it on the day. Every kind of fact.
ALTER TABLE facts ADD COLUMN ask_text TEXT;
