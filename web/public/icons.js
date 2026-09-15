// 픽토그램 — 화면 이름 옆에 서는 그림.
//
// 예전에는 이모지(📓 ✉️ 📅)를 그대로 썼다. 이모지는 기기마다 다른 그림이 뜨고,
// 저마다 색과 광택이 달라 나란히 세우면 줄이 서지 않는다. 그래서 **한 벌로 그린
// 선 그림**으로 바꾼다 — 굵기 하나(1.75), 크기 하나(24), 색은 언제나 currentColor.
// 색을 품지 않으므로 검은 줄 위에서도, 흰 알약 안에서도 같은 그림이 그대로 선다.
//
// 그림 하나는 **한눈에 읽혀야 한다.** 봉투는 봉투로, 달력은 달력으로. 설명이 필요한
// 그림은 여기에 두지 않는다.

const wrap = (inner) =>
  `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"
        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${inner}</svg>`;

/** 화면(서비스) 그림. key 는 services.js 의 key 와 같다. */
const SERVICE_ICONS = {
  // 집
  dashboard: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V20h13V9.5"/><path d="M9.5 20v-6h5v6"/>',
  // 액자 속 사진
  wepic: '<rect x="3" y="4.5" width="18" height="15" rx="1"/><path d="m3 15.5 4.5-4 3.5 3 4-4.5L21 15"/><circle cx="8.5" cy="9" r="1.3"/>',
  // 지갑
  gagyebu: '<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H18v3"/><rect x="3" y="7.5" width="18" height="12" rx="1.5"/><path d="M21 12h-4a1.75 1.75 0 0 0 0 3.5h4"/>',
  // 카드
  cardmoa: '<rect x="2.5" y="5" width="19" height="14" rx="1.5"/><path d="M2.5 9.5h19"/><path d="M6 14.5h4"/>',
  // 책
  taylor: '<path d="M4 4.5h11a2.5 2.5 0 0 1 2.5 2.5v12.5H6.5A2.5 2.5 0 0 1 4 17Z"/><path d="M4 17a2.5 2.5 0 0 1 2.5-2.5h11"/><path d="M8 8.5h6"/>',
  // 지도 핀
  timeline: '<path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z"/><circle cx="12" cy="10" r="2.5"/>',
  // 연필이 놓인 종이
  jadenwiki: '<path d="M6 3.5h7.5L19 9v11.5H6Z"/><path d="M13.5 3.5V9H19"/><path d="M9 13h6"/><path d="M9 16.5h4"/>',
  // 문서
  wordwriter: '<path d="M6 3.5h7.5L19 9v11.5H6Z"/><path d="M13.5 3.5V9H19"/><path d="M9 12.5h6"/><path d="M9 16h6"/>',
  // 지구본 (홈페이지)
  julie: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/><path d="M12 3.5c2.4 2.5 3.6 5.4 3.6 8.5s-1.2 6-3.6 8.5c-2.4-2.5-3.6-5.4-3.6-8.5S9.6 6 12 3.5Z"/>',
  // 말풍선
  sns: '<path d="M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v8a1.5 1.5 0 0 1-1.5 1.5H9l-5 4Z"/>',
  // 카메라
  gphotos: '<path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h3L9 4.5h6L16.5 7h3A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5Z"/><circle cx="12" cy="13" r="3.5"/>',
  // 봉투
  gmail: '<rect x="2.5" y="5" width="19" height="14" rx="1.5"/><path d="m2.5 7 9.5 6.5L21.5 7"/>',
  // 달력
  gcalendar: '<rect x="3.5" y="5" width="17" height="15" rx="1.5"/><path d="M3.5 9.5h17"/><path d="M8 3v4"/><path d="M16 3v4"/>',
  // 네모 안의 체크
  gtasks: '<rect x="3.5" y="3.5" width="17" height="17" rx="2"/><path d="m8 12.5 2.8 2.8L16.5 9.5"/>',
  // 메모지 + 펜
  naver: '<path d="M5 4.5h9.5L19 9v10.5H5Z"/><path d="M8.5 9.5h5"/><path d="M8.5 13h7"/><path d="M8.5 16.5h4"/>',
  // 구름
  onedrive: '<path d="M7 18.5a4 4 0 0 1-.4-7.98A5.5 5.5 0 0 1 17.3 10a3.75 3.75 0 0 1 .2 8.5Z"/>',
};

/** 포털이 쓰는 나머지 그림 — 메뉴·단추·상태. */
const UI_ICONS = {
  home: SERVICE_ICONS.dashboard,
  user: '<circle cx="12" cy="8" r="3.75"/><path d="M4.5 20c0-3.6 3.4-5.75 7.5-5.75s7.5 2.15 7.5 5.75"/>',
  log: '<path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h10"/>',
  admin: '<path d="M12 3.5 5 6.5v5c0 4.3 2.9 7.8 7 9 4.1-1.2 7-4.7 7-9v-5Z"/><path d="m9.2 12 2 2 3.6-3.8"/>',
  pop: '<path d="M9 5h10v10"/><path d="M19 5 9.5 14.5"/><path d="M15 19H5V9"/>',
  close: '<path d="m6 6 12 12"/><path d="m18 6-12 12"/>',
  reload: '<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4.5V10h-5.5"/>',
  menu: '<path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/>',
  lock: '<rect x="4.5" y="10" width="15" height="10.5" rx="1.75"/><path d="M8 10V7.5a4 4 0 0 1 8 0V10"/>',
  unlock: '<rect x="4.5" y="10" width="15" height="10.5" rx="1.75"/><path d="M8 10V7.5a4 4 0 0 1 7.7-1.5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  folder: '<path d="M3.5 6.5A1.5 1.5 0 0 1 5 5h4l2 2.5h8a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5Z"/>',
  note: SERVICE_ICONS.jadenwiki,
  star: '<path d="m12 3.5 2.7 5.6 6.1.85-4.4 4.3 1.05 6.1L12 17.5l-5.45 2.85L7.6 14.25 3.2 9.95l6.1-.85Z"/>',
  trash: '<path d="M4.5 6.5h15"/><path d="M9.5 6.5V4h5v2.5"/><path d="M6.5 6.5 7.5 20.5h9l1-14"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  back: '<path d="M19 12H5"/><path d="m11 6-6 6 6 6"/>',
  share: '<circle cx="17.5" cy="6" r="2.75"/><circle cx="6.5" cy="12" r="2.75"/><circle cx="17.5" cy="18" r="2.75"/><path d="m9 10.7 6-3.4"/><path d="m9 13.3 6 3.4"/>',
  download: '<path d="M12 4v11"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5"/><path d="M4.5 19.5h15"/>',
  upload: '<path d="M12 19.5v-11"/><path d="M7.5 13 12 8.5l4.5 4.5"/><path d="M4.5 4.5h15"/>',
  copy: '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="1.75"/><path d="M15.5 5.5v-.5a1.5 1.5 0 0 0-1.5-1.5H5.5A1.5 1.5 0 0 0 4 5v8.5A1.5 1.5 0 0 0 5.5 15H6"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
  code: '<path d="m9 8-5 4 5 4"/><path d="m15 8 5 4-5 4"/>',
  pen: '<path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17Z"/><path d="m14.5 6.5 3 3"/>',
  cloud: SERVICE_ICONS.onedrive,
  empty: '<rect x="3.5" y="6.5" width="17" height="13" rx="1.5"/><path d="M3.5 6.5 7 3.5h10l3.5 3"/><path d="M9.5 11h5"/>',
  camera: '<path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h3L9 4.5h6L16.5 7h3A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5Z"/><circle cx="12" cy="13" r="3.5"/>',
  thread: '<path d="M12 20.5c-4.7 0-8-3.4-8-8.5S7.3 3.5 12 3.5s8 3.4 8 8.5c0 3.4-1.9 5.6-4.4 5.6-1.7 0-2.8-1-2.8-2.6V11"/><circle cx="11.6" cy="13.4" r="2.9"/>',
  people: '<circle cx="9" cy="8.5" r="3.25"/><path d="M3 19.5c0-3.1 2.7-5 6-5s6 1.9 6 5"/><path d="M16 5.6a3.25 3.25 0 0 1 0 5.9"/><path d="M17.5 14.9c2 .6 3.5 2.1 3.5 4.6"/>',
  send: '<path d="M21 3.5 10.8 13.8"/><path d="M21 3.5 14.6 21l-3.8-7.2L3.5 10Z"/>',
  link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l2.6-2.6a4.5 4.5 0 0 0-6.4-6.4L11.3 6.3"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0L5 12.6a4.5 4.5 0 0 0 6.4 6.4l1.3-1.3"/>',
  image: '<rect x="3" y="4.5" width="18" height="15" rx="1"/><path d="m3 15.5 4.5-4 3.5 3 4-4.5L21 15"/><circle cx="8.5" cy="9" r="1.3"/>',
  dot: '<circle cx="12" cy="12" r="3.5"/>',
};

/** 화면 그림 하나. 모르는 key 는 점 하나로 둔다(이모지로 되돌아가지 않는다 — 줄이 어긋난다). */
export const serviceIco = (key) => wrap(SERVICE_ICONS[key] || UI_ICONS.dot);

/** 포털 그림 하나. */
export const ico = (name) => wrap(UI_ICONS[name] || UI_ICONS.dot);

export const hasServiceIco = (key) => !!SERVICE_ICONS[key];
