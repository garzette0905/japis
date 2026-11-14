-- A retry of the same phone share must not create another note.
ALTER TABLE wiki_notes ADD COLUMN received_share_id TEXT;
CREATE UNIQUE INDEX idx_wiki_received_share ON wiki_notes(user_id, received_share_id);
