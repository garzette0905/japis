# JAPIS

**J**aden's **A**utomated **P**ersonal **I**ntelligence **S**ervice — 흩어져 있는 개인 서비스를
한자리에서 여는 개인 전용 포털입니다. (기획 배경은 [docs/CONCEPT.md](docs/CONCEPT.md) 참고)

wepic·가계부와 **같은 얼개**입니다: Cloudflare Worker 하나가 백엔드 전부이고, 프론트엔드는
`web/public` 을 정적 자산으로 그대로 서빙합니다. 빌드 단계가 없습니다.

## 구성

| 폴더 · 파일 | 내용 |
|---|---|
| `web/public/` | 화면 (HTML·CSS·JS) — Worker의 정적 자산으로 그대로 서빙 |
| `cloudflare/index.js` | 백엔드 Worker — 인증·권한·잠금해제·관리자 API |
| `cloudflare/services.js` | **화면(서비스) 목록. 화면을 늘릴 때 고치는 유일한 파일** |
| `schema.sql` | 사용자·화면권한·접속기록 (D1) 스키마 |
| `migrations/` | 이미 운영 중인 D1에 표·컬럼을 더하는 스크립트(한 번씩 실행) |
| `docs/` | 기획 노트 |
| `wrangler.toml` | Cloudflare 설정 (D1·KV·크론·도메인) |

## 이 포털이 지키는 세 가지

1. **첫 화면은 로그인뿐입니다.** 어떤 주소로 들어와도(`/admin` 을 직접 쳐도) 서버는 빈
   껍데기 HTML만 내보냅니다. 메뉴·서비스 목록은 로그인한 뒤 API로만 받으므로, 로그인
   전에는 페이지 소스를 뒤져도 **어떤 화면이 있는지조차** 알 수 없습니다.
2. **화면마다 다시 인증합니다.** 서비스의 실제 주소는 응답에 담기지 않습니다. 주소는
   `/go/<key>` 가 302로만 알려주고, 그 앞에 비밀번호 재확인(잠금해제)이 서 있습니다.
   한 번 풀면 그 화면만, 정해진 시간(기본 10분) 동안 열립니다.
3. **가입이 없습니다.** 관리자가 사람을 만들고, 그 사람이 볼 화면을 골라 줍니다.

## 최초 로그인

1. 배포 후 `https://<주소>/` 로 들어갑니다.
2. 이메일에 **`garzette@paran.com`**, 비밀번호는 **비워 두고** 로그인합니다.
   (users 표가 비어 있으면 이 계정이 비밀번호 없이 자동으로 만들어집니다)
3. 곧바로 비밀번호 설정 화면이 뜹니다. 여기서 정한 비밀번호가 저장되는 순간
   **비밀번호 없는 로그인 문은 스스로 닫힙니다.**
4. 상단 **관리** 메뉴에서 사용자를 만들고 화면 권한을 골라 줍니다.

> ⚠️ 2번과 3번 사이에는 이메일만 알면 누구나 들어올 수 있습니다. 배포 직후 바로
> 마치세요. 다른 이메일로 시작하려면 `ADMIN_EMAIL` 시크릿을 먼저 등록하면 됩니다.

## 화면 하나 더 붙이기

[`cloudflare/services.js`](cloudflare/services.js) 의 `SERVICES` 배열에 한 덩어리를 더하고
push하면 끝입니다. DB 마이그레이션이 필요 없습니다.

```js
{
  key: 'newthing',            // 한 번 정하면 바꾸지 않는다(권한표가 이 값으로 붙는다)
  label: '새 서비스',
  group: 'service',           // home | service | tool | connect
  desc: '한 줄 설명',
  url: 'https://example.com', // null 이면 카드에 '준비중'으로 뜨고 열리지 않는다
  repo: 'garzette0905/newthing',
  accent: 'teal',             // 카드 머리띠 색(장식 전용)
  icon: '✨',
  reauth: true,               // 들어갈 때 비밀번호를 한 번 더 받을지(기본값)
  external: true,             // 다른 사이트로 나가면 true
}
```

새 화면은 기본적으로 **아무에게도 보이지 않습니다**(관리자 제외). 관리 → 화면 권한에서
사람마다 켜 주세요.

## 지금 연결된 화면

| 묶음 | 화면 | 주소 |
|---|---|---|
| 서비스 | wepic | https://wepic.kr |
| 서비스 | 가계부 | https://gagyebu.wepiclab.workers.dev |
| 서비스 | 카드모아 | https://cardmoa.wepiclab.workers.dev |
| 서비스 | Taylor Bookshelf | https://taylor-bookshelf.pages.dev |
| 서비스 | Julie English | https://julieenglish.co.kr |
| 도구 | 온라인 갤러리 · 구글 타임라인 · 기업정보 에이전트 · Word Writer · 개인 위키 | 준비중 (저장소만 있음) |
| 연동 | Google · OneDrive · Naver Memo | 준비중 (기획서 2단계) |

## 로컬 실행

```bash
npm install
cp .dev.vars.example .dev.vars   # SESSION_SECRET 을 아무 긴 문자열로 채운다
npm run db:local                 # 로컬 D1에 표 생성 (최초 1회)
npm run dev                      # wrangler dev — 기본 http://localhost:8787
```

## 배포

**Cloudflare Workers** — `main` 에 push하면 자동 배포됩니다. 설정 절차(D1·KV·시크릿)는
[cloudflare/README.md](cloudflare/README.md) 참고.

> ⚠️ `migrations/` 에 새 파일이 생겼다면 **push하기 전에** 운영 D1에도 한 번 적용해야
> 합니다. 새 코드가 읽을 표가 배포 시점에 이미 있어야 오류가 나지 않습니다.

## 화면 디자인

따뜻한 종이색 바탕(`#f6f5f4`) 위에 흰 카드를 얹고, **구조에 쓰는 색은 파랑 하나**
(`#0075de` — 버튼·링크·활성표시)뿐입니다. 알록달록한 색(분홍·보라·주황·청록·초록·하늘)은
카드 머리띠와 아이콘 같은 **장식에만** 씁니다. 어두운 자리는 로그인 화면의 밤하늘
(`#213183`) 하나뿐입니다. 글꼴은 **Noto Sans KR**, 제목은 클수록 자간을 좁힙니다.
자세한 토큰은 [`web/public/styles.css`](web/public/styles.css) 맨 위에 있습니다.
