# 내 자동차 정보

개인서비스의 `#/car`에는 자동차 등록 정보, `#/car/history`에는 전체 정비 기록과
원본, `#/car/driving`에는 운행 km 입력과 엔진오일·타이어 교환 알림을 표시한다.
관리자는 기본 접근하고 일반 사용자는 관리 → 화면 권한 → 내 자동차 정보를 허용한다.
권한이 있어도 다른 사람의 차량은 조회하지 않는다. 차량 데이터가 없는 계정은 빈 상태를 표시한다.

## 데이터와 원본

`migrations/023_car.sql`을 배포 전에 운영 D1에 적용한다. `car_profiles`는 사용자별
검토한 최초 자료와 알림 주기를 저장하며 `car_entries`는 이후 직접 입력한 기록이다.
원본은 기존 비공개 R2 `japis-wiki`의 `car/<user_id>/`에 둔다. 공개 정적 자산과
Git에는 등록증·사진·개인 정비 내역을 넣지 않는다. 화면과 원본 API 모두 로그인,
서비스 권한, 계정별 데이터 확인을 통과해야 하며 응답은 `private, no-store`다.

검토한 manifest 형식은 다음과 같다. 모든 개인정보가 담긴 입력은 Git에서 제외되는
로컬 작업 폴더에만 보관한다. 사진은 EXIF를 포함한 원본 그대로 보존한다.

```json
{
  "profile": {"model":"차명", "photo":"hero.jpg", "gallery":"gallery.jpg", "registrationSources":[]},
  "records": [{"id":"import-1","date":"2024-01-01","km":null,"kind":"repair","title":"정비명","items":[],"sources":[],"cost":null,"notes":"","status":"기록 확인"}],
  "sources": [{"file":"hero.jpg","name":"원본 이름.jpg","sha256":"원본 파일 SHA-256"}],
  "followUps": ["검사서에 기재된 점검 권고"],
  "reviewNotes": ["자료 판독상의 주의점"]
}
```

원본 파일 이름은 영문 소문자·숫자·하이픈과 jpg/png/pdf 확장자를 사용한다.
manifest의 `sources[].file`과 같은 이름으로 원본 폴더에 보관한 뒤 실행한다.

```powershell
node tools/car-import.mjs --data=report_work/car/data.json --originals=report_work/car/originals --email=owner@example.com
```

가져오기는 원본 해시를 먼저 검증하고 계정을 이메일로 확인한다. 원본을 업로드한 후
프로필을 적용한다. 업로드 체크포인트로 재개할 수 있으며, 같은 프로필 재가져오기는
직접 입력한 기록과 설정을 보존한다. 다른 저장소로 이동할 때는 체크포인트를 제거하고
원본을 다시 업로드한다. 소스 코드만 재배포해도 운영 D1/R2의 기존 기록은 유지된다.

## 교환 알림

알림 주기는 처음에는 비어 있다. 제조사·정비소 기준을 확인하여 거리와 개월을
직접 설정하며, 먼저 도달한 조건을 표시한다. 최신 실제 교환일의 km가 미확인이면
이전 교환 건의 km로 대신 계산하지 않는다. 타이어 결제는 `tire-purchase`이며 실제
장착 `tire` 기록과 구분한다. 운행 km는 계기판 누적값을 입력한다. 날짜별 이전·이후
기록과 모순되는 값은 거절한다. 오입력은 직접 입력 기록을 삭제한 뒤 다시 입력한다.
자료의 마지막 km는 현재 km와 구분해서 표시한다. 알림은 화면 조회용이다.

`npm test`는 기존 전체 검사와 자동차의 인증·계정 격리·입력 검증·교환일 계산을 검증한다.
