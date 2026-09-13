# JAPIS 로드맵

## 반영 완료 (2026-09-12)

### 1. 모바일 생체인증 — 완료

- 대상: **최초 접속(로그인)** · **화면 이동 시 재인증(잠금해제)** 두 곳 모두.
- WebAuthn 패스키로 붙였다. 비밀번호를 대신하는 것이 아니라 나란히 둔 두 번째 길이다.
- `userVerification: 'required'` — "기기를 갖고 있다"가 아니라 "생체인증을 통과했다"만
  통과한다. 열쇠는 rpId(호스트)에 매이고, 서버에는 공개키만 남는다.
- 등록은 **내 계정 → 생체인증 → 이 기기 등록** (현재 비밀번호를 한 번 더 받는다).
- 기기에 지문·얼굴 잠금이 없으면 버튼 자체를 띄우지 않는다.

### 2. 메뉴 재구성 — 완료

`service`/`tool`/`connect` 3분류 → **개인서비스 / 홈페이지 / 협업**.

| 묶음 | 화면 |
|---|---|
| 개인서비스 | wepic · 가계부 · 카드모아 · Taylor Bookshelf · 타임라인 · 제이든 wiki |
| 홈페이지 | Word Writer · Julie · SNS |
| 협업 | 구글 포토 · 구글 메일 · 구글 캘린더 · 네이버 메모 · One Drive |

- "구글 타임라인" → **타임라인** (key `timeline` 은 그대로 — 권한표가 그 값으로 붙어 있다)
- **제이든 wiki** 신설 — 옵시디언(`obsidian://open?vault=Jaden`)으로 연결
- **SNS** 신설 — 포털 안 화면 하나에 인스타그램·Thread·Facebook·Telegram
- **삭제**: 온라인 갤러리 · 개인 위키 · 기업정보 에이전트 (권한 행은 `migrations/001` 이 정리)

### 3. 협업 카드에 최근 데이터 — 얼개 완료, 열쇠 대기

카드 앞면에 최근 것 몇 개가 올라온다(안 읽은 메일 제목 · 다가오는 일정 · 최근 사진
썸네일 · 최근에 연 문서). Worker가 API 프록시가 되고 브라우저는 토큰을 만지지 않는다.

- 구글 포토·메일·캘린더는 **연결 하나를 나눠 쓴다** — 한 번 동의하면 셋 다 열린다.
- Refresh Token 은 AES-GCM 으로 싸서 D1에 둔다. 피드는 5분 캐시.
- 잠긴 화면은 **잠금을 푼 뒤에만** 내용이 보인다.
- 네이버 메모는 API가 없어 지금은 링크(memo.naver.com)만 — 자체 제작이 그 자리다.

---

## 남은 일

### 곧 해야 하는 것 (사람 손이 필요)

| 할 일 | 어디를 고치나 |
|---|---|
| 구글·마이크로소프트 OAuth 클라이언트 등록 후 시크릿 4개 넣기 | Cloudflare 대시보드 — [cloudflare/README.md](cloudflare/README.md) 3번 |
| 옵시디언 **보관함 이름** 확인 (`vault=Jaden` 이 맞는지) | [cloudflare/services.js](cloudflare/services.js) `jadenwiki` |
| SNS 5곳을 본인 계정·채널 주소로 | [cloudflare/services.js](cloudflare/services.js) `sns.links` |
| Word Writer 배포 후 **Prompt Builder 주소** 적기 | [cloudflare/services.js](cloudflare/services.js) `wordwriter.url` |
| 타임라인 배포 후 주소 적기 | [cloudflare/services.js](cloudflare/services.js) `timeline.url` |

### 그다음

- **네이버 메모 자체 제작** — 네이버가 메모 API를 열지 않아 링크로는 여기까지다.
  포털 안에 메모 화면을 직접 만들면 최근 글 미리보기까지 같은 방식으로 붙는다.
- **검색(3단계)** — Cloudflare Vectorize 로 메모·문서·사진 캡션을 한 번에.
  협업 데이터가 모이고 난 뒤의 이야기다.
