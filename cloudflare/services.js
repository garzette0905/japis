// JAPIS 화면(서비스) 목록 — **여기 한 곳만 고치면 화면이 는다.**
//
// 왜 DB가 아니라 코드인가: 화면이 늘어나는 일은 언제나 배포와 함께 일어난다.
// (새 서비스의 주소·설명·아이콘은 사람이 정해서 커밋하는 값이다.) D1에는
// "누가 어떤 화면을 볼 수 있는가"(user_services)만 두고, 목록 자체는 파일로 둔다.
// 그래야 화면을 하나 더 붙일 때 마이그레이션을 돌리지 않아도 된다.
//
// 필드
//   key      URL·권한표에 쓰는 고유 이름. 한 번 정하면 바꾸지 않는다
//            (user_services 의 행이 이 값으로 붙어 있다).
//   label    상단 메뉴·카드에 뜨는 이름
//   group    상단 메뉴의 묶음. GROUPS 에 있는 것만 쓴다
//   desc     카드 아래 한 줄 설명
//   url      들어갈 주소. null 이면 '준비중'으로 뜨고 눌리지 않는다
//   repo     GitHub 저장소 (선택) — 아직 배포 전인 것을 어디서 보는지 알려준다
//   accent   카드 머리띠 색. 노션 스티커 팔레트에서 고른다(장식 전용)
//   icon     예전에 카드에 얹던 이모지 하나. **화면에는 더 이상 쓰지 않는다** —
//            그림은 web/public/icons.js 가 key 로 찾아 그리는 선 그림이다(이모지는
//            기기마다 다른 그림이 떠서 나란히 세우면 줄이 서지 않았다).
//            화면을 하나 더 붙였다면 icons.js 의 SERVICE_ICONS 에 같은 key 로 그림을
//            하나 더한다. 없으면 점 하나로 뜬다.
//   reauth   들어갈 때 비밀번호를 한 번 더 받을지. **지금은 모두 false 다** —
//            이미 로그인한 사람에게 링크 하나 누를 때마다 비밀번호를 또 묻는 것은
//            보태는 안전보다 깎아먹는 쓸모가 컸다. 장치 자체는 남겨 두었으니,
//            특별히 가려야 할 화면이 생기면 여기서 true 로 되돌리면 된다
//            (관리자가 사용자별로 덮어쓸 수도 있다 — user_services.reauth)
//   external true 면 다른 사이트로 나간다(새 탭). false 면 포털 안 화면.
//   account  이 화면이 쓰는 계정(선택). 카드에 그대로 적어 둔다 — 여러 계정을
//            오가는 협업 묶음에서 "지금 어느 계정으로 들어가는지"가 늘 헷갈린다.
//   route    포털 **안**의 화면일 때 그 해시 주소(선택). 있으면 새로 고치지 않고
//            그 자리에서 넘어간다. /go/<key> 로 직접 들어와도 같은 곳에 닿는다.
//   frameUrl 오른쪽 프레임에서만 쓰는 다른 주소(선택). 본 화면은 프레임을 막아 두었지만
//            '붙여 쓰라고' 따로 내주는 주소가 있는 곳에 적는다(구글 캘린더의 임베드).
//            ↗(새 탭)는 언제나 위의 url 로 나간다 — 프레임은 보기용, 새 탭은 쓰기용.
//   frame    false 면 오른쪽 프레임에 담지 않고 언제나 새 탭으로 연다(선택).
//            true 면 **조사하지 않고** 담는다. 로그인해야 보이는 임베드에 쓴다 —
//            서버는 로그인하지 않은 채로 두드리므로 구글 로그인 화면(DENY)을 보고
//            "막혔다"고 잘못 판단한다. 실제 브라우저에서 빈 칸이 뜨면 이 줄을 지운다.
//            제공자가 프레임을 막는 것이 확실한 곳(구글·네이버·OneDrive)과 http(s)가
//            아닌 주소(obsidian://)에 적어 둔다 — 굳이 물어보고 실패할 이유가 없다.
//            적지 않으면 서버가 한 번 열어 보고 판단한다(/api/frameable).
//   links    한 카드가 여러 바깥 주소를 묶을 때(선택). SNS 처럼 "모음" 성격의 화면이
//            쓴다. 공개 사이트 주소라 숨길 것이 없어 목록 API에 그대로 실어 보낸다
//            (감추는 것은 개인 서비스의 주소다 — 그건 /go/<key> 만 안다).

/**
 * 구글 화면을 **이 계정으로** 여는 주소.
 *
 * 왜 `?authuser=<이메일>` 로는 안 되는가 — 구글 서비스마다 다르게 군다.
 *   · 캘린더  : 지킨다
 *   · 메일    : 로그인 화면으로 넘어가면서 조용히 **버린다**
 *   · 포토    : 아예 **지우고** photos.google.com/ 로 튕긴다. 거기서 세션이 없거나
 *               기본 계정(u/0)이 다른 사람이면 www.google.com/photos/about/ —
 *               즉 **소개 페이지**가 뜬다. "구글 포토가 안 열린다"의 정체가 이것이다.
 *
 * AccountChooser 는 계정을 먼저 고르게 한 뒤 continue 로 넘긴다. 이미 그 계정으로
 * 로그인해 있으면 그대로 통과하고, 여러 계정이 물려 있으면 **이 계정으로 바꿔 준다**.
 * 로그인 전이면 이메일이 채워진 로그인 화면이 뜬다. 어느 쪽이든 엉뚱한 곳에 닿지 않는다.
 *
 * ⚠️ 프레임에 넣는 주소(frameUrl)에는 쓰지 않는다 — accounts.google.com 은 프레임을 막는다.
 */
const googleAs = (email, target) =>
  `https://accounts.google.com/AccountChooser?Email=${encodeURIComponent(email)}` +
  `&continue=${encodeURIComponent(target)}`;

export const GROUPS = [
  { key: 'home', label: '대시보드' },
  { key: 'personal', label: '개인서비스' },
  { key: 'homepage', label: '홈페이지' },
  { key: 'collab', label: '협업' },
];

export const SERVICES = [
  // ── 대시보드 ──────────────────────────────────────────────────────────
  // 포털 자신. 로그인하면 늘 보이고, 재인증도 걸지 않는다(여기까지는 세션이 곧 인증이다).
  {
    key: 'dashboard',
    label: '대시보드',
    group: 'home',
    desc: '연결된 서비스를 한자리에서 연다',
    url: '/',
    accent: 'sky',
    icon: '🏠',
    reauth: false,
    external: false,
    always: true,           // 권한표와 무관하게 모두에게 보인다
  },
  // ── 개인서비스 ────────────────────────────────────────────────────────
  {
    // 예전에는 이 자리가 옵시디언(obsidian://open?vault=Jaden)이었다. 그 주소는 이 컴퓨터의
    // 프로그램을 부르는 것이라 휴대폰에서도, 남의 컴퓨터에서도 열리지 않았다.
    // 이제 **포털 안 화면**이다 — 메모가 D1에 있어 어디서 들어와도 같은 것을 본다.
    // (key 는 그대로 둔다. user_services 의 권한 행이 이 값으로 붙어 있다.)
    key: 'jadenwiki',
    label: 'Jaden Meno',
    group: 'personal',
    desc: '메모를 쓰고 폴더로 묶고 검색한다 — 사진·html 파일까지',
    url: '/#/wiki',
    route: '#/wiki',
    accent: 'purple',
    icon: '📓',
    reauth: false,
    external: false,
  },
  {
    // 북마크 — 자주 가는 주소를 내 손으로 정리해 두는 자리. 브라우저 즐겨찾기는
    // 기기마다 따로 놀고 회사 컴퓨터와 집 컴퓨터가 서로를 모른다. 여기 것은 D1에
    // 있으므로 어디서 들어와도 같은 목록이다.
    //
    // **업무와 개인을 먼저 가른다.** 업무 주소는 회사 망 안에서만 열릴 수 있으므로,
    // 눌러 봐야 시간만 버린다 — 섞어 두지 않고 칸을 나눠 둔다. 폴더는 한 겹 더
    // 들어간다(하위 폴더).
    key: 'bookmarks',
    label: '북마크',
    group: 'personal',
    desc: '업무·개인으로 나눠 담는 주소록 — 폴더 안에 폴더까지',
    url: '/#/bookmarks',
    route: '#/bookmarks',
    // 진한 금색. 옆 기둥에서 제 색으로 서는 줄은 헬스정보(빨강)와 이 줄 둘뿐이다
    // — 리본 모양과 금색이 함께 붙어야 '끼워 둔 자리'로 읽힌다.
    accent: 'gold',
    icon: '🔖',
    reauth: false,
    external: false,
  },

  {
    key: 'gagyebu',
    label: '가계부',
    group: 'personal',
    desc: '카드·계좌 내역을 모아 보는 가계·자산 장부',
    url: 'https://gagyebu.wepiclab.workers.dev/',
    repo: 'garzette0905/gagyebu',
    accent: 'green',
    icon: '💰',
    reauth: false,
    external: true,
  },
  {
    key: 'cardmoa',
    label: '카드모아',
    group: 'personal',
    desc: '카드 정보를 모아 비교한다',
    url: 'https://cardmoa.wepiclab.workers.dev',
    repo: 'garzette0905/cardmoa',
    accent: 'orange',
    icon: '💳',
    reauth: false,
    external: true,
  },
  {
    key: 'taylor',
    label: 'Taylor Bookshelf',
    group: 'personal',
    desc: '읽은 책과 읽을 책을 꽂아 두는 책장',
    url: 'https://taylor-bookshelf.pages.dev',
    repo: 'garzette0905/taylor-bookshelf',
    accent: 'teal',
    icon: '📚',
    reauth: false,
    external: true,
  },
  {
    // Play Lists — 가수를 적어 두고 그 아래 곡을 쌓는다.
    //
    // 스트리밍 서비스의 목록은 그 서비스 안에서만 산다 — 멜론에 담은 것은 유튜브에서
    // 안 보이고, 유튜브에 담은 것은 애플에서 안 보인다. 여기 것은 **내가 적어 둔
    // 목록**이라 어디서 듣든 그대로 남는다(들을 주소는 곡마다 따로 붙인다).
    key: 'playlists',
    label: 'Play Lists',
    group: 'personal',
    desc: '가수와 곡을 적어 두는 내 음악 목록',
    url: '/#/playlists',
    route: '#/playlists',
    accent: 'pink',
    icon: '🎵',
    reauth: false,
    external: false,
  },
  {
    key: 'timeline',            // key 는 그대로 둔다(권한표가 이 값으로 붙어 있다)
    label: '타임라인',
    group: 'personal',
    desc: '이동 기록을 달력·지도로 되짚어 본다',
    url: 'https://timeline.wepiclab.workers.dev/',
    repo: 'garzette0905/google-timeline',
    accent: 'sky',
    icon: '🗺️',
    reauth: false,
    external: true,
  },
  {
    // 헬스정보 — 연 1회 종합검진을 **검사항목별 연도 트렌드**로 본다.
    //
    // 결과지 한 권은 그 해만 말한다. 공복혈당이 96 → 88 → 101 로 움직인 것은
    // 세 권을 나란히 펴 놓아야 보이고, 그래서 아무도 보지 않는다. 여기서는
    // 항목을 코드 하나로 모아 두므로(migrations/010) 한 줄로 이어진다.
    //
    // (key 는 그대로 둔다 — 예전 '건강검진' 자리의 권한 행이 이 값으로 붙어 있다.)
    key: 'healthcheck',
    label: '헬스정보',
    group: 'personal',
    // 인바디·혈액은 한때 옆에 따로 선 메뉴였다. 걷었다 — 메뉴에서 나란히 설
    // 이유가 없다. 셋 다 내 몸의 같은 기록이고, 보는 사람은 "건강 얘기"를 하러
    // 한 번 들어온다. 지금은 이 화면 안의 탭 셋이다(#/health/inbody · /blood).
    desc: '검진 · 인바디 · 피검사를 검사항목별 추이로 본다',
    url: '/#/health',
    route: '#/health',
    accent: 'red',
    icon: '♡',
    reauth: false,
    external: false,
  },
  // ── 홈페이지 ──────────────────────────────────────────────────────────
  {
    // wepic — **홈페이지 묶음**이다. 개인서비스에 두었던 것을 내렸다.
    // 개인서비스는 '내가 쓰는 도구'이고, wepic 은 주소를 아는 사람이면 누구나
    // 여는 **바깥에 서 있는 사이트**다. 줄리·SNS 와 같은 성격이라 같은 칸에 둔다.
    key: 'wepic',
    label: 'wepic',
    group: 'homepage',
    desc: '구글 포토 사진을 감성 슬라이드쇼로 — 웹 사진 액자',
    url: 'https://wepic.kr',
    repo: 'garzette0905/wepic-live',
    accent: 'pink',
    icon: '🖼️',
    reauth: false,
    external: true,
  },
  {
    key: 'julie',
    label: 'Julie',
    group: 'homepage',
    desc: '줄리영어학원 홈페이지',
    url: 'https://julieenglish.co.kr',
    repo: 'garzette0905/julie-enlgish',
    accent: 'purple',
    icon: '🔤',
    reauth: false,          // 바깥에 공개된 홈페이지라 한 번 더 물을 이유가 없다
    external: true,
  },
  {
    key: 'sns',
    label: 'SNS',
    group: 'homepage',
    desc: '인스타그램 · Threads · Facebook · Telegram · X · LinkedIn · 다모앙',
    url: '/#/sns',
    route: '#/sns',
    accent: 'pink',
    icon: '💬',
    reauth: false,
    external: false,
    // 본인 계정 주소(프로필·채널)가 정해지면 여기만 고친다.
    // ico 는 icons.js 의 그림 이름이다. SNS 는 **그 회사의 공식 마크**를 쓴다
    // (BRAND_ICONS) — 링크 목록에서 눈이 찾는 것은 이름이 아니라 그 동그란 마크다.
    links: [
      { label: '인스타그램', ico: 'instagram', url: 'https://www.instagram.com' },
      { label: 'Threads', ico: 'threads', url: 'https://www.threads.net' },
      { label: 'Facebook', ico: 'facebook', url: 'https://www.facebook.com' },
      { label: 'Telegram', ico: 'telegram', url: 'https://web.telegram.org' },
      { label: 'X', ico: 'x', url: 'https://x.com' },
      { label: 'LinkedIn', ico: 'linkedin', url: 'https://www.linkedin.com/feed/' },
      // 다모앙 — 국내 커뮤니티. 로그인해야 보이는 글이 많아 새 탭으로 나가는 것이 낫다.
      { label: '다모앙', ico: 'damoang', url: 'https://damoang.net' },
    ],
  },

  {
    key: 'wordwriter',
    label: 'Word Writer',
    group: 'homepage',
    desc: '보고서 종류를 고르면 Prompt Builder 가 열린다',
    // 배포되면 **Prompt Builder 화면 주소**를 적는다(첫 화면이 곧 Prompt Builder 여야 한다).
    url: null,
    repo: 'garzette0905/samsung-word-writer-pro',
    accent: 'orange',
    icon: '📄',
    reauth: false,
    external: true,
  },

  // ── 협업 ──────────────────────────────────────────────────────────────
  // 계정을 지정한 바로가기 + 카드 앞면의 최근 항목(/api/feed).
  //
  // 구글 넷은 주소를 전부 googleAs() 로 감쌌다. 경로에 이메일을 넣는 법
  // (/mail/u/<이메일>/)은 구글이 그 자리를 계정 번호로 읽어 "요청한 URL을 찾을 수
  // 없습니다"가 되고, `?authuser=<이메일>` 은 서비스마다 지키기도 하고 버리기도 한다
  // (포토는 아예 지우고 소개 페이지로 튕긴다). 자세한 것은 googleAs() 주석 참고.
  {
    key: 'gphotos',
    label: '구글 포토',
    group: 'collab',
    desc: '사진과 앨범을 연다',
    url: googleAs('garzette@gmail.com', 'https://photos.google.com/'),
    account: 'garzette@gmail.com',
    accent: 'sky',
    icon: '📷',
    reauth: false,
    frame: false,           // 구글은 X-Frame-Options: DENY 로 내려온다
    external: true,
  },
  {
    key: 'gmail',
    label: '구글 메일',
    group: 'collab',
    desc: '받은 편지함을 연다',
    url: googleAs('garzette@gmail.com', 'https://mail.google.com/mail/u/0/'),
    account: 'garzette@gmail.com',
    accent: 'orange',
    icon: '✉️',
    reauth: false,
    frame: false,           // 구글은 X-Frame-Options: DENY 로 내려온다
    external: true,
  },
  {
    key: 'gcalendar',
    label: '구글 캘린더',
    group: 'collab',
    desc: '일정을 연다',
    url: googleAs('garzette@gmail.com', 'https://calendar.google.com/calendar/r'),
    // 캘린더 본 화면은 X-Frame-Options: SAMEORIGIN 이라 프레임에 담기지 않는다. 다만
    // **임베드 주소**는 애초에 남의 사이트에 붙이라고 만든 것이라 그 헤더가 없다 —
    // 오른쪽 프레임에서는 이쪽을 쓴다(↗ 로 새 탭을 열면 위의 본 화면으로 나간다).
    // mode=AGENDA 는 좁은 칸에서 가장 잘 읽히는 '일정 목록' 모양이다.
    //   바꿀 수 있는 것: mode=MONTH|WEEK|AGENDA · ctz(시간대) · showTitle=0 등
    frameUrl:
      'https://calendar.google.com/calendar/embed?src=garzette%40gmail.com&ctz=Asia%2FSeoul&mode=AGENDA&showTitle=0&showPrint=0&showCalendars=0',
    account: 'garzette@gmail.com',
    accent: 'green',
    icon: '📅',
    reauth: false,
    external: true,
  },
  {
    key: 'gtasks',
    label: '구글 할일',
    group: 'collab',
    desc: '할 일 목록을 연다',
    url: googleAs('garzette@gmail.com', 'https://tasks.google.com/'),
    // 캘린더와 같은 얼개다 — 프레임에서는 '붙여 쓰라고' 내주는 임베드 주소를 쓰고,
    // ↗(새 탭)는 위의 본 화면으로 나간다.
    frameUrl: 'https://tasks.google.com/embed/list/~default?fullWidth=1',
    frame: true,            // 로그인해야 보이는 임베드라 서버 조사로는 판정할 수 없다
    account: 'garzette@gmail.com',
    accent: 'purple',
    icon: '✅',
    reauth: false,
    external: true,
  },
  {
    key: 'onedrive',
    label: 'One Drive',
    group: 'collab',
    desc: '문서를 찾아본다',
    url: 'https://onedrive.live.com',
    account: 'garzette@naver.com',
    accent: 'teal',
    icon: '☁️',
    reauth: false,
    frame: false,           // OneDrive 도 프레임을 막는다
    external: true,
  },
];

export const SERVICE_MAP = new Map(SERVICES.map((s) => [s.key, s]));
export const serviceOf = (key) => SERVICE_MAP.get(String(key || '')) || null;

/** 권한표와 무관하게 모두에게 보이는 화면(지금은 대시보드 하나). */
export const isAlways = (s) => !!s && s.always === true;

/** 아직 주소가 없는 화면. 카드에 '준비중'으로 뜨고 /go/<key> 도 열지 않는다. */
export const isReady = (s) => !!s && typeof s.url === 'string' && s.url.length > 0;
