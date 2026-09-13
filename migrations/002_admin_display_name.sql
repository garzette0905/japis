-- 002 — 관리자 표시 이름을 'Jaden' 으로.
--
-- 대시보드 인사말은 users.name 을 그대로 부른다("좋은 저녁입니다, ○○님").
-- 최초 관리자는 예전 코드가 이름을 '관리자'로 박아 넣었다(지금은 'Jaden').
-- 이미 만들어진 행은 코드가 고쳐 주지 않으므로 여기서 한 번 바꾼다.
--
-- 실행: npx wrangler d1 execute japis-db --remote --file=./migrations/002_admin_display_name.sql

UPDATE users
   SET name = 'Jaden'
 WHERE role = 'admin'
   AND (name IS NULL OR name = '' OR name = '관리자');
