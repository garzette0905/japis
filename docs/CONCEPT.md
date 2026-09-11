# JAPIS 기획 노트

원본: *(서비스 기본개념) 개인 포털 아키텍처 및 네이밍 제안* (2026-09-12).
원본 PDF는 개인 문서라 저장소에 올리지 않고, 결정된 내용만 여기에 남긴다.

## 이름

**JAPIS** — *Jaden's Automated Personal Intelligence Service* (자피스 / 제이피스).

JPI(Jaden Personal Intelligence)에 구동 체계(**S**ystem/**S**ervice)를 붙인 이름이다.
영화 속 J.A.R.V.I.S.의 어감과 "모든 개인 서비스와 데이터를 지능적으로 관리해 주는
나만의 AI 집사"라는 정체성이 자연스럽게 이어진다.

> 후보였던 것들: ZEPI(제피) · MYPI(마이피) · KINPI(킨피) · JAPI(자피) · JPIX(제이픽스) ·
> JADEPI(제이드피).

## 왜 독립 프로젝트인가

기존 사이트의 서브페이지가 아니라 **독립된 Cloudflare Worker 프로젝트로 새로 짓는다.**

| | 독립 프로젝트 (선택) | 기존 사이트 서브페이지 |
|---|---|---|
| 장점 | 독립된 보안 영역(인증 Token·API Key 격리) · 메인 서비스가 바뀌어도 포털은 무사 · 기술 스택 자유 | 초기 설정·도메인 연결이 간편 · 기존 배포 파이프라인 재활용 |
| 단점 | 배포 파이프라인·도메인 추가 설정 필요 | 메인 서비스 유지보수가 포털에 옮겨붙음 · OAuth 콜백 등 보안 권한이 엉킬 위험 |

연결하려는 것들(wepic, 외부 OAuth, 개인 위키, 가계부…)이 단순한 '링크 모음'을 넘어
**인증 Token 관리 · API 프록시 · 개인 데이터 캐싱 · 대시보드 UI** 로 확장될 가능성이
높다는 것이 결정의 근거다.

## 아키텍처

```
                  [ JAPIS Gateway / Dashboard ]
                   (Cloudflare Worker + Assets)
                              │
       ┌──────────────────────┼──────────────────────┐
       ▼                      ▼                      ▼
 [ 개인 웹 UI/서비스 ]   [ OAuth / API 프록시 ]   [ 자체 DB & 캐시 ]
  · wepic                · Google (Drive,         · Cloudflare D1  (사용자·권한·기록)
  · 카드모아               Photos, Gmail,          · Cloudflare KV  (세션·화면잠금)
  · 가계부 / 위키           Calendar, Timeline)     · Vectorize      (검색 — 훗날)
  · Taylor Bookshelf     · OneDrive
  · Julie English        · Naver Memo
```

**기획서와 달라진 점 하나.** 기획서는 인증을 Cloudflare Access(Zero Trust)에 맡기자고
했다. 실제로는 **자체 계정 체계**를 만들었다. Access는 "본인 1명만"에는 잘 맞지만,
요구가 그보다 넓었기 때문이다.

- 관리자가 **사용자를 만든다**(가족·지인 계정)
- 사용자마다 **볼 화면을 골라 준다**
- **화면마다 다시 인증**을 받는다

Access는 문 앞에서 한 번 걸러 줄 뿐, 이 세 가지를 표현하지 못한다. 대신 wepic·가계부가
이미 쓰고 있는 D1 + KV + PBKDF2 얼개를 그대로 가져와, 같은 방식으로 관리한다.

## 1단계 — 지금 (완료)

- 로그인 게이트 · 관리자 사용자 생성 · 화면별 권한 · 화면별 재인증 · 접속 기록
- 이미 배포된 서비스 5개 연결 (wepic · 가계부 · 카드모아 · Taylor Bookshelf · Julie English)
- 아직 배포 전인 것 5개는 카드 자리만 잡아 둠 (갤러리 · 타임라인 · 기업정보 · Word Writer · 위키)

## 2단계 — 통합 위젯 (기획서의 "Data Aggregation")

`connect` 묶음(Google · OneDrive · Naver)이 그 자리다. Worker가 API 프록시가 되어
대시보드에 바로 얹는다.

- **Google Calendar / Gmail / Naver Memo**: 최신 일정, 안 읽은 메일, 메모 요약을 한눈에
- **Google Drive / OneDrive / Photos**: 개별 사이트로 옮겨가지 않고 검색·퀵뷰

필요한 것: 제공자별 OAuth 클라이언트, Refresh Token 을 담을 자리(Worker Secret + KV,
암호화 저장), 그리고 각 위젯의 캐시 정책. `cloudflare/services.js` 의 `connect` 항목에
`url` 을 채우고 내부 화면을 붙이면 그날부터 열린다.

## 3단계 — 검색

Cloudflare Vectorize 로 포털이 들고 있는 것들(메모·문서·사진 캡션)을 한 번에 찾는다.
2단계의 데이터가 모이고 난 뒤의 이야기다.
