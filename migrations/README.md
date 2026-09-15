# migrations/

이미 운영 중인 D1에 표·컬럼을 더하는 스크립트를 둡니다. 한 번씩만 실행합니다.

```bash
npx wrangler d1 execute japis-db --remote --file=./migrations/00X_....sql
```

`schema.sql` 의 `CREATE TABLE IF NOT EXISTS` 는 표가 이미 있으면 통째로 건너뛰므로,
**나중에 더한 컬럼은 schema.sql 을 다시 돌려도 생기지 않습니다.** SQLite에는
`ALTER TABLE ... ADD COLUMN IF NOT EXISTS` 가 없어서, 재실행하면 "duplicate column"
오류로 멈춥니다 → 그래서 별도 파일로 나눕니다.

> ⚠️ 새 파일을 만들었다면 **push하기 전에** 운영 D1에 먼저 적용하세요.
> 새 코드가 읽을 표가 배포 시점에 이미 있어야 합니다.

| 파일 | 내용 |
|---|---|
| `001_biometric_connect_menu.sql` | 생체인증(패스키) 표·컬럼, 협업 연동 토큰 표, 없어진 화면(갤러리·위키·기업정보·google)의 권한 행 정리 |
| `002_admin_display_name.sql` | 관리자 표시 이름 '관리자' → 'Jaden' (대시보드 인사말이 읽는 값) |
| `003_drop_reauth.sql` | 화면 열 때의 재인증(비밀번호 재확인) 끄기 — 남아 있는 권한 행이 코드 기본값을 덮어쓰므로 |
| `004_wiki.sql` | Jaden wiki(포털 안 메모) — 메모·폴더·첨부파일 이름표 세 표 |
| `005_wiki_share.sql` | 메모 공유 — `wiki_notes.share_token` · `shared_at` (주소 하나로 남에게 보여주기) |
