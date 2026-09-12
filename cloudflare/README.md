# JAPIS — Cloudflare Workers 배포

JAPIS의 **유일한 백엔드**입니다. wepic·가계부와 같은 구성이라, 그쪽을 알고 있다면
새로 익힐 것이 없습니다.

- **Worker 코드**: `cloudflare/index.js` · **화면 목록**: `cloudflare/services.js`
- **설정**: 저장소 **루트**의 `wrangler.toml` (Cloudflare가 루트 설정을 기대하므로 루트에 둠)
- **세션·화면잠금**: Workers KV(`SESSIONS`) · **사용자·권한·기록**: D1(`DB`) ·
  **정적**: `web/public`(복사 없이 그대로 서빙) · **기록 정리**: Cron(매일)

주소: `https://japis.<계정>.workers.dev` (커스텀 도메인은 아래 4번 참고)

---

## 1. 리소스 (이미 만들어져 있음)

| 종류 | 이름 | id |
|---|---|---|
| D1 | `japis-db` | `e724f59c-1ed6-4359-bc82-6f979d54f328` |
| KV | `japis-sessions` | `5be6b1eb23184dc686709984f36e1e37` |

다시 만들어야 한다면:

```bash
npx wrangler d1 create japis-db
npx wrangler kv namespace create japis-sessions
```

출력된 id를 루트 `wrangler.toml` 에 붙여 넣습니다.

## 2. 스키마 적용

```bash
npx wrangler d1 execute japis-db --remote --file=./schema.sql
```

> `migrations/` 에 파일이 생기면 **배포 전에** 같은 방식으로 한 번씩 적용합니다.

## 3. 시크릿 (Settings → Variables and secrets → Add → **Encrypt**)

| 이름 | 값 | 필수 |
|---|---|---|
| `SESSION_SECRET` | 세션 서명용 임의의 긴 문자열(16자 이상) | ✅ 없으면 로그인 자체가 거부됩니다 |
| `ADMIN_EMAIL` | 최초 관리자 이메일. 기본값 `garzette@paran.com` | 선택 |
| `GOOGLE_CLIENT_ID` · `GOOGLE_CLIENT_SECRET` | 구글 포토·메일·캘린더 최근 항목 미리보기 | 선택 |
| `MS_CLIENT_ID` · `MS_CLIENT_SECRET` | OneDrive 최근 항목 미리보기 | 선택 |

> ⚠️ `SESSION_SECRET` 을 바꾸면 협업 연결의 토큰을 풀 수 없게 됩니다(그 열쇠로 싸 두기
> 때문입니다). 카드에서 *연결하기* 를 한 번 더 누르면 됩니다.

### 협업 연동 키 만들기 (선택)

**구글** — [Google Cloud Console](https://console.cloud.google.com/) → 프로젝트 생성 →
*API 및 서비스*에서 **Photos Library API · Gmail API · Calendar API** 사용 설정 →
*OAuth 동의 화면*(외부, 테스트 사용자에 본인 계정 추가) → *사용자 인증 정보 →
OAuth 클라이언트 ID(웹 애플리케이션)*.

**마이크로소프트** — [Microsoft Entra](https://entra.microsoft.com/) → *앱 등록* →
지원 계정 유형은 **개인 Microsoft 계정**.

두 곳 모두 **승인된 리디렉션 URI** 에 아래를 그대로 넣습니다(쓰는 주소마다 하나씩):

```
https://<포털주소>/connect/google/callback
https://<포털주소>/connect/microsoft/callback
```

등록한 뒤 포털에서 **협업 → 연결하기** 를 누르면 그날부터 카드에 최근 항목이 올라옵니다.

```bash
npx wrangler secret put SESSION_SECRET
```

> ⚠️ **`ADMIN_PASSWORD` 같은 것은 없습니다.** 최초 관리자는 비밀번호 없이 한 번 들어와
> 그 자리에서 비밀번호를 정합니다(README의 "최초 로그인" 참고). 비밀번호가 정해지는
> 순간 그 문은 닫힙니다.

> ⚠️ 빌드가 성공해 **스크립트가 배포된 뒤**에야 시크릿 추가가 가능합니다
> ("static assets only" 상태 해제).

## 4. 빌드 설정 (Settings → Build)

- **Root directory**: (비움 = 저장소 루트)
- **Build command**: `npm install`
- **Deploy command**: `npx wrangler deploy`

`main` 에 push하면 자동 배포됩니다.

> 루트 `wrangler.toml` 에 `main`(핸들러)과 `assets`(web/public)가 함께 있어,
> `wrangler deploy` 가 **스크립트 Worker**로 배포합니다(정적 전용 아님).

> ⚠️ **무료 플랜 CPU 한도(요청당 10ms) 주의** — 비밀번호 해시(PBKDF2 10만 회)는 무거운
> 작업이지만 Workers가 암호 연산에 쓰는 시간은 이 한도에 들어가지 않습니다. 다만
> 반복 횟수를 10만 회보다 크게 잡으면 **운영에서만** `NotSupportedError` 로 로그인이
> 죽습니다(로컬 miniflare에는 이 제한이 없어 눈치채기 어렵습니다).

## 5. 커스텀 도메인 (선택)

도메인을 Cloudflare에 등록(영역 추가)한 뒤 루트 `wrangler.toml` 의 `[[routes]]` 주석을
풀고 배포하면, Cloudflare가 DNS 레코드와 SSL 인증서를 자동으로 만들어 줍니다.
그리고 `[vars]` 의 `SITE_HOSTS` 에 그 도메인을 적어 주세요(요청 주소를 그대로 믿어도
되는 곳의 목록입니다).

`workers_dev = true` 는 그대로 두세요 — 커스텀 도메인을 붙이면 Cloudflare가
`*.workers.dev` 주소를 자동으로 꺼버립니다.

## 6. 확인

| 확인할 것 | 기대 결과 |
|---|---|
| `/` | 로그인 화면만 |
| `/admin` 직접 입력 | 역시 로그인 화면 (껍데기 HTML은 메뉴를 담고 있지 않다) |
| `/api/status` (로그아웃 상태) | `{"loggedIn":false,"configured":true}` — 그 이상 아무것도 |
| `/go/wepic` (로그아웃 상태) | 401 |
| 로그인 후 잠긴 카드 클릭 | 비밀번호 재확인 모달 |
| 관리 → 접속 기록 | 로그인·잠금해제·화면열기가 남는다 |

> 📌 Cloudflare가 자동 생성한 `workers-autoconfig` 브랜치/PR이 보이면 **머지하지 말고
> 무시/삭제**하세요(정적 전용 설정이라 이 저장소와 맞지 않습니다).
