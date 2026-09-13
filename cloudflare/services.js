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
//   icon     카드에 얹는 이모지 하나
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
//            제공자가 프레임을 막는 것이 확실한 곳(구글·네이버·OneDrive)과 http(s)가
//            아닌 주소(obsidian://)에 적어 둔다 — 굳이 물어보고 실패할 이유가 없다.
//            적지 않으면 서버가 한 번 열어 보고 판단한다(/api/frameable).
//   links    한 카드가 여러 바깥 주소를 묶을 때(선택). SNS 처럼 "모음" 성격의 화면이
//            쓴다. 공개 사이트 주소라 숨길 것이 없어 목록 API에 그대로 실어 보낸다
//            (감추는 것은 개인 서비스의 주소다 — 그건 /go/<key> 만 안다).

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
    key: 'wepic',
    label: 'wepic',
    group: 'personal',
    desc: '구글 포토 사진을 감성 슬라이드쇼로 — 웹 사진 액자',
    url: 'https://wepic.kr',
    repo: 'garzette0905/wepic-live',
    accent: 'pink',
    icon: '🖼️',
    reauth: false,
    external: true,
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
    key: 'timeline',            // key 는 그대로 둔다(권한표가 이 값으로 붙어 있다)
    label: '타임라인',
    group: 'personal',
    desc: '이동 기록을 달력·지도로 되짚어 본다',
    url: null,
    repo: 'garzette0905/google-timeline',
    accent: 'sky',
    icon: '🗺️',
    reauth: false,
    external: true,
  },
  {
    key: 'jadenwiki',
    label: '제이든 wiki',
    group: 'personal',
    desc: '옵시디언 보관함을 그대로 연다',
    // ⚠️ 보관함(vault) 이름이 다르면 옵시디언이 "없는 보관함"이라며 멈춘다.
    //    실제 이름으로 바꿔 두세요. 옵시디언 Publish 를 쓰게 되면 그 https 주소가 더 낫다.
    url: 'obsidian://open?vault=Jaden',
    accent: 'purple',
    icon: '📓',
    reauth: false,
    frame: false,           // obsidian:// 은 웹 주소가 아니다 — 프레임에 담을 수 없다
    external: true,
  },

  // ── 홈페이지 ──────────────────────────────────────────────────────────
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
    desc: '인스타그램 · Thread · Facebook · Telegram',
    url: '/#/sns',
    route: '#/sns',
    accent: 'pink',
    icon: '💬',
    reauth: false,
    external: false,
    // 본인 계정 주소(프로필·채널)가 정해지면 여기만 고친다.
    links: [
      { label: '인스타그램', icon: '📷', url: 'https://www.instagram.com' },
      { label: 'Thread', icon: '🧵', url: 'https://www.threads.net' },
      { label: 'Facebook', icon: '👥', url: 'https://www.facebook.com' },
      { label: 'Telegram', icon: '✈️', url: 'https://web.telegram.org' },
    ],
  },

  // ── 협업 ──────────────────────────────────────────────────────────────
  // 지금은 **계정을 지정한 바로가기**다. 주소에 계정을 박아 두었으므로 구글 세 개는
  // 한 번 로그인해 두면 그대로 이어진다.
  //
  // ⚠️ 구글 주소에 계정을 박는 법은 `?authuser=<이메일>` 하나뿐이다.
  //    /mail/u/<이메일>/ · /calendar/u/<이메일>/r 처럼 경로에 이메일을 넣으면
  //    구글이 그 자리를 **계정 번호(0·1·2…)** 로 읽어 "요청한 URL을 찾을 수 없습니다"를
  //    띄운다. 번호는 로그인 순서에 따라 바뀌므로 번호로 박아 두어서도 안 된다. "최근 데이터를 대시보드에 얹는 것"(위젯)은
  // 제공자별 OAuth 클라이언트와 Refresh Token 자리가 필요해 아직 하지 않았다 —
  // roadmap.md 참고.
  {
    key: 'gphotos',
    label: '구글 포토',
    group: 'collab',
    desc: '사진과 앨범을 연다',
    url: 'https://photos.google.com/?authuser=garzette@gmail.com',
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
    url: 'https://mail.google.com/mail/u/?authuser=garzette@gmail.com',
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
    url: 'https://calendar.google.com/calendar/r?authuser=garzette@gmail.com',
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
    key: 'naver',               // key 는 그대로 둔다(예전 'Naver Memo' 권한이 이어진다)
    label: '네이버 메모',
    group: 'collab',
    // 자체 제작 전까지는 네이버 메모를 그대로 연다. 네이버는 메모 API를 열지 않아
    // 최근 글 미리보기는 붙일 수 없다 — 링크만 둔다.
    desc: '네이버 메모를 연다 — 자체 제작 전까지',
    url: 'https://memo.naver.com',
    account: 'garzette',
    accent: 'green',
    icon: '📝',
    reauth: false,
    frame: false,           // 네이버도 프레임을 막는다
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
