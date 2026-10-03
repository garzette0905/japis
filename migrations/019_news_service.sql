-- Jaden AI NEWS 를 'sns' 카드에서 떼어 개인서비스의 새 화면 'news' 로 세운다.
-- 'sns' 권한이 있던 사람은 그동안 그 카드로 AI NEWS 를 봤으므로 'news' 권한도 같이 준다.
INSERT OR IGNORE INTO user_services (user_id, service_key, allowed, reauth, unlock_ttl)
SELECT user_id, 'news', allowed, 0, NULL FROM user_services WHERE service_key = 'sns';
