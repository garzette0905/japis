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
| `006_bookmarks.sql` | 북마크 — `bookmark_folders` · `bookmarks` 두 표 (사내·사외, 하위 폴더) + 기존 wiki 사용자에게 권한 부여 |
| `007_playlists.sql` | Play Lists — `music_artists` · `music_tracks` 두 표 + 권한 부여, 없어진 네이버 메모 권한 정리 |
| `008_usage_rankings.sql` | 개인서비스·북마크·메모 폴더 클릭 누적 및 하루 단위 확정 순위 |
| `009_music_play_counts.sql` | Play Lists 듣기 클릭 누적, FLO 스트리밍 횟수 메모를 초기값으로 한 번 이관 |
| `010_health.sql` | 헬스정보 — `health_exams`·`health_metrics`·`health_results` 세 표 + 검사항목 이름표 170줄 + 권한 부여 |
| `011_health_seed_2022_2024.sql` | 강북삼성병원 2024년 결과지에서 옮겨 적은 2022·2023·2024 종합검진과 2024 인바디 |
| `012_health_inbody_blood.sql` | '인바디·혈액' 별도 메뉴 철수, 인바디 상세 항목(세포내외수분·부위별 근육·체세포량 등) 보완, '혈액'을 결과지 스무 항목으로 좁힘, 2025-11-06 혈액검사·2026-04-30 인바디 |
| `013_health_2025.sql` | 2025-09-02 종합검진(SCL — 병원이 바뀌어 참고범위를 행마다 기록), 혈액검사 4회(2023~2024), 인바디 10회(2024-11~2026-03, 그 중 한 번은 ACCUNIQ) |
| `014_health_2017_2021.sql` | 2021년 결과지 한 권에서 나온 2017~2021 — 종합검진 5회(2018은 검진과 재검 둘) + 2021 인바디. 2017은 값 표가 아니라 연도별 그래프에서 옮겨 적었다 |
| `015_health_2025_spring.sql` | 스캔한 종이 결과지에서 옮겨 적은 인바디 5회(2025-03-28·04-29·07-16·08-13, 2026-07-03)와 2025-04-08 혈액검사(GC Labs — 참고범위를 행마다 기록) |
| `016_bookmark_order_and_shared_notes.sql` | 북마크 드래그 순서 컬럼과 공유 화면 메뉴 권한 |
| `017_global_logout.sql` | 전체 기기 로그아웃용 세션 버전과 옛 공유 메뉴 권한 정리 |
| `018_health_daily.sql` | 헬스정보 → 삼성헬스 탭 — `health_daily`(날짜 × 항목, 하루 한 값)와 가져온 기록 `health_daily_imports` |
