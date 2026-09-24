-- 전체 기기의 JAPIS 로그인 세션을 한 번에 무효화할 버전.
ALTER TABLE users ADD COLUMN session_epoch INTEGER NOT NULL DEFAULT 0;

-- 공유 목록은 대시보드로 이동했다. 기존 메뉴 권한 행은 더 이상 사용하지 않는다.
DELETE FROM user_services WHERE service_key = 'sharednotes';
