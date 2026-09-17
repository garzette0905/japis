# web/ — JAPIS 화면

이 폴더에는 **화면(정적 자산)만** 있습니다 (`web/public/`). 빌드 단계가 없습니다.

- **백엔드**: `cloudflare/index.js` — 설정·배포는 [`cloudflare/README.md`](../cloudflare/README.md)
- **로컬 실행**: 저장소 루트에서 `npm run dev` (wrangler dev)

## 파일

| 파일 | 역할 |
|---|---|
| `index.html` | 껍데기. **로그인 화면만** 마크업으로 들어 있다 — 메뉴·서비스 목록은 여기에 없다 |
| `app.js` | 로그인 뒤의 모든 화면(대시보드·묶음별 목록·내 계정·관리자)을 그린다 |
| `wiki.js` · `wiki.css` | Jaden wiki(포털 안 메모) 화면 |
| `bookmarks.js` · `bookmarks.css` | 북마크(사내·사외 주소록) 화면 |
| `playlists.js` · `playlists.css` | Play Lists(가수·곡) 화면 |
| `icons.js` · `util.js` | 한 벌로 그린 픽토그램 · 화면들이 함께 쓰는 자잘한 것 |
| `styles.css` | 전체 스타일. 색·글꼴·간격 토큰이 파일 맨 위에 모여 있다 |
| `manifest.json` | 홈 화면에 설치할 때 쓰는 정보 |
| `favicon.svg` · `icon-192.png` · `icon-512.png` · `apple-touch-icon.png` | 앱 아이콘 — 파란 판 위의 J(같은 좌표로 구운 한 벌) |
| `og-japis.png` | 링크 미리보기 카드에 서는 그림(1200×630). 로그인 없이 열린다 |
| `robots.txt` | 검색 차단(개인 포털이라 전부 Disallow) |

## 왜 껍데기가 비어 있나

로그인하지 않은 사람이 페이지 소스를 뒤져도 **어떤 화면이 있는지조차 알 수 없어야**
하기 때문입니다. `app.js` 는 아무것도 미리 알고 있지 않고, `/api/status` 가 준 것만
그립니다. 서비스의 실제 주소는 아예 내려오지 않습니다 — 열 때 `/go/<key>` 로 나가고,
그 주소는 서버만 압니다.
