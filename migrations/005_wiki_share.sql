-- 005 — Jaden wiki 메모 공유 (주소 하나로 남에게 보여주기)
--
--   npx wrangler d1 execute japis-db --remote --file=./migrations/005_wiki_share.sql
--
-- 설계
--   · 메모마다 **길고 무작위한 이름표**(share_token) 하나를 붙인다. 그 이름표를 아는
--     사람만 /s/<이름표> 로 그 메모 하나를 본다. 로그인은 묻지 않는다 — 대신 이름표를
--     32자 hex(128비트)로 뽑아 찍어 맞힐 수 없게 한다. 메모 번호(1, 2, 3…)를 주소에
--     쓰면 옆 번호를 눌러 남의 메모가 보이므로 번호는 주소에 절대 넣지 않는다.
--   · 공유는 **켜야 생긴다.** 기본은 NULL(공유 안 함)이고, 끄면 다시 NULL 로 돌아간다
--     (이름표를 지운다 = 돌던 주소가 그 순간 죽는다). 다시 켜면 새 이름표가 나온다.
--   · UNIQUE 인덱스를 둔다. 이름표 하나가 메모 둘을 가리키는 일이 없어야 한다.

ALTER TABLE wiki_notes ADD COLUMN share_token TEXT;
ALTER TABLE wiki_notes ADD COLUMN shared_at   TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_wiki_notes_share ON wiki_notes (share_token);
