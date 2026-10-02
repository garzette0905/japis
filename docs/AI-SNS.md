# Jaden AI SNS

기존 `sns` 권한과 `/#/sns` 주소를 유지하면서 X 스타일 통합 읽기 화면으로 변경했다.
마이크로칩 아이콘, 시간순 피드, 플랫폼/AI·IT 필터, 최신 조회 Top 5, Threads 연속 글을 제공한다.
기본 Threads 관심 계정은 사용자가 지정한 `choi.openai`다. 각 사용자가 저장한 목록이 우선한다.
관심 계정 저장은 SNS 실제 팔로우 동작이 아니다.

## 운영 연결

기존 `connections` 테이블과 `SESSIONS` KV를 사용한다. 추가 DB 마이그레이션은 없다.
다음 네 값을 Cloudflare Worker 시크릿에 등록한다. 로컬 개발에는 `.dev.vars`에만 넣는다.

- `X_CLIENT_ID`, `X_CLIENT_SECRET`: X OAuth 2.0 confidential web app. PKCE와 `tweet.read users.read follows.read offline.access` 권한.
- `THREADS_CLIENT_ID`, `THREADS_CLIENT_SECRET`: Meta Threads 앱. `threads_basic`, `threads_profile_discovery`, `threads_read_replies` 권한. 앱 공개 범위에 맞는 심사/테스터 설정이 필요하다.

OAuth redirect URI는 실제 접속 도메인을 사용해 정확히 등록한다.

```
https://<JAPIS 도메인>/api/sns/x/callback
https://<JAPIS 도메인>/api/sns/threads/callback
```

로그인한 JAPIS에서 `Jaden AI SNS → 계정 연결`을 누르고 X/Threads 승인 화면에서 현재 계정을 확인한다.
브라우저의 기존 로그인 쿠키는 JAPIS 서버가 읽을 수 없으므로 자동 연결을 주장하지 않는다.
X 앱은 타임라인 API 사용 권한/이용 한도가 필요하다. 가입·결제는 코드가 수행하지 않는다.
계정 연결 해제는 JAPIS에 저장한 토큰을 삭제하며, 제공자의 앱 권한 철회는 제공자 설정에서 한다.
토큰은 기존 SESSION_SECRET 기반 AES-GCM으로 암호화되고, 클라이언트에는 반환되지 않는다.

## 데이터 범위와 제한

- 진입/새로고침마다 API를 새로 조회한다. 응답은 `Cache-Control: no-store`. X는 최대 3페이지(300건), Threads는 관심 계정 최대 20개 × 50건. 잘린 범위를 화면에 알린다.
- 최근 7일의 조회된 글을 AI·IT 키워드로 분류한다. 맥락을 이해하는 분류가 아니므로 누락/오분류가 가능하다.
- Top 5는 그 범위에서 좋아요+답글+재게시+인용 합계가 큰 순서다. 동률은 최신순. 누락 수치는 0으로 바꾸지 않고 순위에서 제외한다.
- Threads 공개 프로필 API의 반응 수는 현재 구현에서 제공되지 않는다. 따라서 Threads는 시간순 피드에 포함되지만 Top 5에는 포함되지 않는다. **양 플랫폼 전체 인기 Top 5는 현재 제공할 수 없다.**
- Threads 방문 기록/팔로우 타임라인을 읽는 공식 API 대신 명시적인 관심 계정 목록을 사용한다. 비공개 계정은 조회되지 않을 수 있다.
- Threads `conversation`에서 접근 가능한 작성자의 후속 글을 오래된 순으로 보여준다. 타인 글의 대화 접근은 앱 권한에 따라 거절될 수 있다. 실패/잘린 결과는 원문 안내로 표시하며 전체 글을 가져왔다고 주장하지 않는다.
- 토큰 갱신: X refresh token, Threads long-lived token을 만료 7일 전부터 갱신. 이미 만료되면 재연결한다.
- 제공자 한쪽 오류/호출 한도/개별 관심 계정 오류가 전체 피드를 막지 않도록 분리했다.
- 관심 계정은 사용자 ID별 KV에 저장하며 KV 특성상 다른 리전에는 반영이 지연될 수 있다.

## 검증

`npm test`로 필터링, 순위/기간/중복, 결측 수치, URL/HTML 안전성, PKCE/state 바인딩과 재사용 거절,
토큰 암호화, 사용자 설정 격리, 부분 실패, 연속 글 순서, 인증 경계를 검증한다.
`npx wrangler deploy --dry-run`으로 Worker 번들링을 검사한다.
실제 운영 계정 end-to-end 검증은 위 앱 설정과 사용자의 연결 승인이 끝난 뒤 수행해야 한다.

공식 참고:
- https://docs.x.com/x-api/posts/timelines/introduction
- https://www.postman.com/meta/threads/documentation/dht3nzz/threads-api
- https://developers.facebook.com/docs/threads

## 2026-10-03 화면 및 Threads 조회 개선

- SNS 메인 화면은 Top 5 카드, Threads 원문 바로가기, 통합 피드로 구성한다.
- 계정 연결·해제와 관심 계정 관리는 `/#/sns/settings`에서 한다.
- 포털 왼쪽 위 메뉴 버튼은 데스크톱에서 전체 메뉴/72px 아이콘 메뉴를 전환하며 브라우저에 선택을 저장한다. 모바일에서는 기존 서랍 메뉴를 연다.
- Threads HTTP 400 중 제공자 코드 100은 최소 게시물 필드로 한 번 재시도한다. 코드 10/200(권한), 190(토큰)은 재시도 없이 필요한 조치를 안내한다. 제공자 원문 오류나 토큰은 노출하지 않는다.
- 본인의 관심 계정은 `/me/threads`, 다른 공개 계정은 `/profile_posts`로 조회한다. API 조회 실패 시에도 등록한 프로필을 Threads 원문에서 열 수 있다.
- 운영 확인: Threads 앱 시크릿과 만료 전 연결 레코드는 존재했다. 사용자가 보고한 `@choi.openai` HTTP 400의 세부 제공자 코드는 기존 응답에 없으므로 실제 계정의 복구 여부는 로그인 후 재조회로 확인해야 한다. 앱 권한·심사 문제는 코드만으로 승인할 수 없다.
