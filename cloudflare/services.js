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
//   reauth   기본값. 관리자가 사용자별로 덮어쓸 수 있다(user_services.reauth)
//   external true 면 다른 사이트로 나간다(새 탭). false 면 포털 안 화면.

export const GROUPS = [
  { key: 'home', label: '대시보드' },
  { key: 'service', label: '서비스' },
  { key: 'tool', label: '도구' },
  { key: 'connect', label: '연동' },
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

  // ── 서비스 (운영 중) ───────────────────────────────────────────────────
  {
    key: 'wepic',
    label: 'wepic',
    group: 'service',
    desc: '구글 포토 사진을 감성 슬라이드쇼로 — 웹 사진 액자',
    url: 'https://wepic.kr',
    repo: 'garzette0905/wepic-live',
    accent: 'pink',
    icon: '🖼️',
    reauth: true,
    external: true,
  },
  {
    key: 'gagyebu',
    label: '가계부',
    group: 'service',
    desc: '카드·계좌 내역을 모아 보는 가계·자산 장부',
    url: 'https://gagyebu.wepiclab.workers.dev',
    repo: 'garzette0905/gagyebu',
    accent: 'green',
    icon: '💰',
    reauth: true,
    external: true,
  },
  {
    key: 'cardmoa',
    label: '카드모아',
    group: 'service',
    desc: '카드 정보를 모아 비교한다',
    url: 'https://cardmoa.wepiclab.workers.dev',
    repo: 'garzette0905/cardmoa',
    accent: 'orange',
    icon: '💳',
    reauth: true,
    external: true,
  },
  {
    key: 'taylor',
    label: 'Taylor Bookshelf',
    group: 'service',
    desc: '읽은 책과 읽을 책을 꽂아 두는 책장',
    url: 'https://taylor-bookshelf.pages.dev',
    repo: 'garzette0905/taylor-bookshelf',
    accent: 'teal',
    icon: '📚',
    reauth: true,
    external: true,
  },
  {
    key: 'julie',
    label: 'Julie English',
    group: 'service',
    desc: '줄리영어학원 홈페이지',
    url: 'https://julieenglish.co.kr',
    repo: 'garzette0905/julie-enlgish',
    accent: 'purple',
    icon: '🔤',
    reauth: false,          // 바깥에 공개된 홈페이지라 한 번 더 물을 이유가 없다
    external: true,
  },

  // ── 도구 (저장소는 있으나 아직 배포 전) ─────────────────────────────────
  // url 이 null 인 항목은 카드에 '준비중'으로 뜨고 눌리지 않는다. 배포가 끝나면
  // 여기 url 한 줄만 채우면 그날부터 열린다.
  {
    key: 'gallery',
    label: '온라인 갤러리',
    group: 'tool',
    desc: '주가·이미지 분석 갤러리',
    url: null,
    repo: 'garzette0905/my_online_gallery',
    accent: 'purple',
    icon: '🎨',
    reauth: true,
    external: true,
  },
  {
    key: 'timeline',
    label: '구글 타임라인',
    group: 'tool',
    desc: '이동 기록을 달력·지도로 되짚어 본다',
    url: null,
    repo: 'garzette0905/google-timeline',
    accent: 'sky',
    icon: '🗺️',
    reauth: true,
    external: true,
  },
  {
    key: 'enterprise',
    label: '기업정보 에이전트',
    group: 'tool',
    desc: '기업 개요를 뽑아 오는 멀티 에이전트',
    url: null,
    repo: 'garzette0905/enterprise_info',
    accent: 'brown',
    icon: '🏢',
    reauth: true,
    external: true,
  },
  {
    key: 'wordwriter',
    label: 'Word Writer',
    group: 'tool',
    desc: '보고서 양식에 맞춰 Word 문서를 만든다',
    url: null,
    repo: 'garzette0905/samsung-word-writer-pro',
    accent: 'orange',
    icon: '📄',
    reauth: true,
    external: true,
  },
  {
    key: 'wiki',
    label: '개인 위키',
    group: 'tool',
    desc: '메모와 자료를 엮어 두는 개인 위키',
    url: null,
    accent: 'teal',
    icon: '📓',
    reauth: true,
    external: false,
  },

  // ── 연동 (기획서 2단계 — Worker API 프록시) ──────────────────────────────
  // 기획서(개인 포털 아키텍처)의 "통합 위젯" 자리다. OAuth 토큰을 Worker Secret·KV에
  // 두고 여기서 캘린더·메일·드라이브를 한눈에 보여줄 계획이다. 지금은 자리만 있다.
  {
    key: 'google',
    label: 'Google',
    group: 'connect',
    desc: '캘린더 · Gmail · 드라이브 · 포토를 한눈에',
    url: null,
    accent: 'sky',
    icon: '🔗',
    reauth: true,
    external: false,
  },
  {
    key: 'onedrive',
    label: 'OneDrive',
    group: 'connect',
    desc: '문서를 포털에서 바로 찾아본다',
    url: null,
    accent: 'teal',
    icon: '☁️',
    reauth: true,
    external: false,
  },
  {
    key: 'naver',
    label: 'Naver Memo',
    group: 'connect',
    desc: '네이버 메모를 대시보드에 모아 본다',
    url: null,
    accent: 'green',
    icon: '📝',
    reauth: true,
    external: false,
  },
];

export const SERVICE_MAP = new Map(SERVICES.map((s) => [s.key, s]));
export const serviceOf = (key) => SERVICE_MAP.get(String(key || '')) || null;

/** 권한표와 무관하게 모두에게 보이는 화면(지금은 대시보드 하나). */
export const isAlways = (s) => !!s && s.always === true;

/** 아직 주소가 없는 화면. 카드에 '준비중'으로 뜨고 /go/<key> 도 열지 않는다. */
export const isReady = (s) => !!s && typeof s.url === 'string' && s.url.length > 0;
