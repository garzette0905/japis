-- 003 — 화면을 열 때 비밀번호를 다시 묻지 않는다.
--
-- 이미 로그인해 들어온 사람에게 링크 하나 누를 때마다 비밀번호를 또 받는 것은,
-- 보태는 안전보다 깎아먹는 쓸모가 컸다. 코드의 기본값은 services.js 에서 false 로
-- 바꿨지만, user_services 에 남아 있는 행이 그 기본값을 **덮어쓰므로**
-- (visibleServices: perm 이 있으면 perm.reauth 가 이긴다) 여기서 함께 내린다.
--
-- 장치 자체는 그대로 남아 있다. 특별히 가려야 할 화면이 생기면
-- 관리 → 화면 권한에서 그 줄만 '재인증'을 다시 켜면 된다.
--
-- 실행: npx wrangler d1 execute japis-db --remote --file=./migrations/003_drop_reauth.sql

UPDATE user_services SET reauth = 0 WHERE reauth <> 0;
