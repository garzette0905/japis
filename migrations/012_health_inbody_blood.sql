-- 012 — 헬스정보: 인바디 상세 항목 보완 · 혈액 패널 정리 · 별도 메뉴 철수
--
--   npx wrangler d1 execute japis-db --remote --file=./migrations/012_health_inbody_blood.sql
--
-- ── 무엇이 바뀌었나 ────────────────────────────────────────────────────
--
-- 1) **'인바디·혈액' 메뉴를 걷는다.** 헬스정보 안의 탭이 되었다. 메뉴에서 나란히
--    설 이유가 없었다 — 셋 다 내 몸의 같은 기록이고, 한 번 들어와 탭으로 고른다.
--
-- 2) **인바디 항목을 InBody 720 용지 기준으로 채운다.** 010 의 이름표는 강북삼성
--    검진 결과지에 실린 요약(근육량·체지방량·체지방률 넷)만 알고 있었다. 실제
--    인바디 용지에는 세포내/외수분, 골무기질, 체세포량, **부위별 근육 다섯 군데**,
--    부종지수, 상완둘레까지 찍혀 나온다. 그것을 다 받는다.
--
-- 3) **'혈액'이 가리키는 것을 좁힌다.** 010 에서는 피검사로 잴 수 있는 것을 전부
--    blood 로 묶었다(CBC·전해질·종양표지자까지 60여 개). 그런데 실제로 주기적으로
--    받는 결과지는 **간·신장·지질·혈당 스무 항목짜리 한 장**이다. 값 입력 폼에
--    예순 칸을 늘어놓으면 스무 칸 채우려고 예순 칸을 지난다. 그래서 그 한 장에
--    실리는 항목만 blood 로 두고, 나머지는 폼 아래 '펼치기'로 내린다.
--
-- 4) **eGFR 을 계산식별로 나눈다.** 같은 '사구체여과율'이라도 MDRD 와 CKD-EPI 는
--    다른 식이라 다른 숫자가 나온다(2024 CKD-EPI 95 · 2025 MDRD 76). 한 선에
--    이으면 있지도 않은 급락이 그려진다 — 코드를 나눠 각자의 선으로 둔다.

-- ── 1. 없어진 메뉴의 권한 행 정리 ─────────────────────────────────────
DELETE FROM user_services WHERE service_key = 'bodylab';

-- ── 2. 새 항목 이름표 ─────────────────────────────────────────────────
INSERT OR REPLACE INTO health_metrics
  (code, name_ko, name_en, unit, category, sort_order, ref_low, ref_high, ref_text, direction, value_type, lab_group, memo)
VALUES
-- 인바디 — 체수분을 안팎으로 가른다
('icw',          '세포내수분',      'Intracellular water',   'L',      'composition', 72,  23.5,  28.7,  '23.5~28.7', 'mid',  'num', 'inbody', '세포 안에 있는 물. 근육이 많을수록 많다'),
('ecw_vol',      '세포외수분',      'Extracellular water',   'L',      'composition', 74,  14.4,  17.6,  '14.4~17.6', 'mid',  'num', 'inbody', '세포 밖(혈액·조직액)의 물'),
('bmc',          '골무기질량',      'Bone mineral content',  'kg',     'composition', 95,  2.89,  3.53,  '2.89~3.53', 'high', 'num', 'inbody', '무기질 중 뼈에 있는 몫(osseous)'),
('bcm',          '체세포량',        'Body cell mass',        'kg',     'composition', 125, 33.6,  41.1,  '33.6~41.1', 'high', 'num', 'inbody', '대사가 일어나는 몸의 알맹이'),
('ecf_tbf',      '부종지수',        'ECF/TBF',               '',       'composition', 112, NULL,  NULL,  '',          'low',  'num', 'inbody', '세포외액/총체액. 높으면 붓기를 의심한다'),
('ac',           '상완위둘레',      'Arm circumference',     'cm',     'composition', 150, NULL,  NULL,  '',          'none', 'num', 'inbody', ''),
('amc',          '상완근육둘레',    'Arm muscle circumference','cm',   'composition', 152, NULL,  NULL,  '',          'high', 'num', 'inbody', '팔의 지방을 뺀 둘레'),
-- 인바디 — 부위별 근육. 좌우가 벌어지는지가 여기서만 보인다
('arm_r',        '오른팔 근육량',   'Right arm lean',        'kg',     'composition', 160, NULL,  NULL,  '',          'high', 'num', 'inbody', ''),
('arm_r_p',      '오른팔 근육 %',   'Right arm lean %',      '%',      'composition', 161, NULL,  NULL,  '',          'high', 'num', 'inbody', '100% = 표준체중 기준의 적정량'),
('arm_l',        '왼팔 근육량',     'Left arm lean',         'kg',     'composition', 162, NULL,  NULL,  '',          'high', 'num', 'inbody', ''),
('arm_l_p',      '왼팔 근육 %',     'Left arm lean %',       '%',      'composition', 163, NULL,  NULL,  '',          'high', 'num', 'inbody', '100% = 표준체중 기준의 적정량'),
('trunk',        '몸통 근육량',     'Trunk lean',            'kg',     'composition', 164, NULL,  NULL,  '',          'high', 'num', 'inbody', ''),
('trunk_p',      '몸통 근육 %',     'Trunk lean %',          '%',      'composition', 165, NULL,  NULL,  '',          'high', 'num', 'inbody', '100% = 표준체중 기준의 적정량'),
('leg_r',        '오른다리 근육량', 'Right leg lean',        'kg',     'composition', 166, NULL,  NULL,  '',          'high', 'num', 'inbody', ''),
('leg_r_p',      '오른다리 근육 %', 'Right leg lean %',      '%',      'composition', 167, NULL,  NULL,  '',          'high', 'num', 'inbody', '100% = 표준체중 기준의 적정량'),
('leg_l',        '왼다리 근육량',   'Left leg lean',         'kg',     'composition', 168, NULL,  NULL,  '',          'high', 'num', 'inbody', ''),
('leg_l_p',      '왼다리 근육 %',   'Left leg lean %',       '%',      'composition', 169, NULL,  NULL,  '',          'high', 'num', 'inbody', '100% = 표준체중 기준의 적정량'),
-- 인바디 — 기계가 권하는 목표. 좋고 나쁨이 아니라 '어느 쪽으로 얼마나'다
('target_weight','적정체중',        'Target weight',         'kg',     'composition', 180, NULL,  NULL,  '',          'none', 'num', 'inbody', ''),
('adj_weight',   '체중조절',        'Weight control',        'kg',     'composition', 182, NULL,  NULL,  '',          'none', 'num', 'inbody', '+ 면 늘리라는 뜻'),
('adj_fat',      '지방조절',        'Fat control',           'kg',     'composition', 184, NULL,  NULL,  '',          'none', 'num', 'inbody', '− 면 줄이라는 뜻'),
('adj_muscle',   '근육조절',        'Muscle control',        'kg',     'composition', 186, NULL,  NULL,  '',          'none', 'num', 'inbody', '+ 면 늘리라는 뜻'),

-- 혈액 — 결과지에 함께 찍혀 나오는데 010 이 몰랐던 것
('ck',           '크레아틴키나제',  'CK (CPK)',              'U/L',    'liver',        75,  NULL,  190,   '< 190',     'low',  'num', 'blood', '근육이 상하면 오른다(운동 직후에도)'),
('hba1c_ifcc',   '당화혈색소(IFCC)','HbA1c (IFCC)',          'mmol/mol','sugar',       22,  NULL,  38,    '≤ 38',      'low',  'num', 'blood', 'NGSP(%) 와 같은 값의 다른 단위'),
('eag',          '평균혈당추정치',  'eAG',                   'mg/dL',  'sugar',        24,  NULL,  NULL,  '',          'low',  'num', 'blood', 'HbA1c 를 평균 혈당으로 환산한 값'),
('egfr_mdrd',    '사구체여과율(MDRD)','eGFR (MDRD)',         'mL/min/1.73m²','kidney', 45,  60,    NULL,  '60~',       'high', 'num', 'blood', 'CKD-EPI 와 계산식이 달라 숫자도 다르다');

-- ── 3. '혈액'이 가리키는 것을 스무 항목으로 좁힌다 ───────────────────
-- (좁힌 것은 **권하는 목록**일 뿐이다. 값 입력 창의 '펼치기'에 나머지가 그대로 있다.)
UPDATE health_metrics SET lab_group = NULL WHERE lab_group = 'blood';

UPDATE health_metrics SET lab_group = 'blood'
 WHERE code IN (
   'ast','alt','ldh','alp','ck','ggtp',          -- 간
   'glucose','hba1c','hba1c_ifcc','eag',         -- 혈당
   'tbil','dbil',                                -- 빌리루빈
   'bun','creatinine','uric_acid','egfr_mdrd',   -- 신장·요산
   'tchol','hdl','ldl','tg'                      -- 지질
 );

-- 신장·체중·BMI·허리둘레는 인바디 용지에도 찍힌다 — 인바디 쪽에 남겨 둔다.
UPDATE health_metrics SET lab_group = 'inbody'
 WHERE code IN ('height','weight','bmi','waist');

-- 010 이 적어 둔 eGFR 설명을 계산식이 보이게 고친다.
UPDATE health_metrics
   SET name_ko = '사구체여과율(추정)', memo = '검사기관이 제 식으로 낸 값. 계산식이 다르면 코드를 나눈다'
 WHERE code = 'egfr';

-- ══════════════════════════════════════════════════════════════════════
-- 4. 2025-11-06 혈액검사 — 삼성SDS 부속의원 → GC Labs
-- ══════════════════════════════════════════════════════════════════════
--
-- ⚠️ 이 회차는 **참고범위를 행마다 적는다.** 같은 검사라도 검사실마다 기준이
--    다르기 때문이다. 요산이 그 증거다 — 강북삼성은 2.8~8.2, 이 검사실은
--    3.4~7.0 이라 같은 3.3 이 한쪽에서는 정상, 한쪽에서는 낮음(L)이다.
--    결과지에 찍힌 H/L 과 화면의 판정이 어긋나면 화면을 믿지 않게 된다.

INSERT OR IGNORE INTO health_exams (user_id, exam_date, kind, provider, title, memo, created_at, updated_at)
  SELECT id, '2025-11-06', 'blood', '삼성SDS 부속의원 (GC Labs)', '2025-11-06 혈액검사',
         '총콜레스테롤 219·LDL 152·공복혈당 104 높음, 요산 3.3 낮음(이 검사실 기준 3.4~7.0).',
         datetime('now'), datetime('now')
    FROM users WHERE role = 'admin' ORDER BY id LIMIT 1;

INSERT OR IGNORE INTO health_results
  (user_id, exam_id, code, value_num, value_text, ref_low, ref_high, ref_text, created_at)
  SELECT e.user_id, e.id,
         json_extract(v.value, '$[0]'),
         json_extract(v.value, '$[1]'),
         '',
         json_extract(v.value, '$[2]'),
         json_extract(v.value, '$[3]'),
         COALESCE(json_extract(v.value, '$[4]'), ''),
         datetime('now')
    FROM health_exams e,
         json_each('[
    ["ast",         19,   0,    40,   "0~40"],
    ["alt",         13,   0,    41,   "0~41"],
    ["ldh",         167,  135,  225,  "135~225"],
    ["alp",         48,   40,   129,  "40~129"],
    ["ck",          103,  null, 190,  "< 190"],
    ["ggtp",        29,   10,   71,   "10~71"],
    ["glucose",     104,  70,   99,   "70~99"],
    ["tbil",        0.5,  0.0,  1.2,  "0.0~1.2"],
    ["dbil",        0.2,  0.0,  0.3,  "0.0~0.3"],
    ["bun",         19,   6,    20,   "6~20"],
    ["creatinine",  1.02, 0.70, 1.20, "0.70~1.20"],
    ["uric_acid",   3.3,  3.4,  7.0,  "3.4~7.0"],
    ["hba1c",       5.8,  null, 5.6,  "≤ 5.6"],
    ["hba1c_ifcc",  40,   null, 38,   "≤ 38"],
    ["eag",         120,  null, null, ""],
    ["tchol",       219,  null, 199,  "< 200"],
    ["hdl",         59,   40,   null, "40~"],
    ["ldl",         152,  null, 129,  "< 130"],
    ["tg",          99,   null, 149,  "< 150"],
    ["egfr_mdrd",   76,   60,   null, "60~"]
  ]') v
   WHERE e.kind = 'blood' AND e.exam_date = '2025-11-06'
     AND e.user_id = (SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1);

-- ══════════════════════════════════════════════════════════════════════
-- 5. 2026-04-30 인바디 — 삼성SDS (InBody 720)
-- ══════════════════════════════════════════════════════════════════════
--
-- BMI 참고범위가 검진 결과지(~24.9)와 다르다(18.5~23.0). 인바디 제조사가
-- 아시아 기준을 쓰기 때문이다 — 이 회차의 행에만 그 범위를 적어 둔다.

INSERT OR IGNORE INTO health_exams (user_id, exam_date, kind, provider, title, memo, created_at, updated_at)
  SELECT id, '2026-04-30', 'inbody', '삼성SDS', '2026 인바디 (InBody 720 · 신체발달 74점)',
         '적정체중 67.4kg · 체중조절 +1.3kg · 지방조절 -2.3kg · 근육조절 +3.6kg. 부위별 근육은 팔(88%)이 다리(100%)보다 낮다.',
         datetime('now'), datetime('now')
    FROM users WHERE role = 'admin' ORDER BY id LIMIT 1;

INSERT OR IGNORE INTO health_results
  (user_id, exam_id, code, value_num, value_text, ref_low, ref_high, ref_text, created_at)
  SELECT e.user_id, e.id,
         json_extract(v.value, '$[0]'),
         json_extract(v.value, '$[1]'),
         '',
         json_extract(v.value, '$[2]'),
         json_extract(v.value, '$[3]'),
         COALESCE(json_extract(v.value, '$[4]'), ''),
         datetime('now')
    FROM health_exams e,
         json_each('[
    ["height",        175,   null, null, ""],
    ["weight",        66.1,  57.3, 77.5, "57.3~77.5"],
    ["bmi",           21.6,  18.5, 23.0, "18.5~23.0"],
    ["icw",           24.6,  23.5, 28.7, "23.5~28.7"],
    ["ecw_vol",       14.8,  14.4, 17.6, "14.4~17.6"],
    ["tbw",           39.4,  37.8, 46.2, "37.8~46.2"],
    ["protein",       10.6,  10.2, 12.4, "10.2~12.4"],
    ["mineral_mass",  3.65,  3.50, 4.28, "3.50~4.28"],
    ["bmc",           3.01,  2.89, 3.53, "2.89~3.53"],
    ["fatmass",       12.4,  8.1,  16.2, "8.1~16.2"],
    ["slm",           50.7,  null, null, ""],
    ["ffm",           53.7,  null, null, ""],
    ["smm",           30.1,  28.8, 35.2, "28.8~35.2"],
    ["bodyfat",       18.8,  10.0, 20.0, "10.0~20.0"],
    ["fatdist",       0.84,  0.80, 0.90, "0.80~0.90"],
    ["vfa",           50.1,  null, 100,  "~100"],
    ["ecw",           0.375, 0.360, 0.390, "0.360~0.390"],
    ["ecf_tbf",       0.329, null, null, ""],
    ["obesity_deg",   98,    90,   110,  "90~110"],
    ["bcm",           35.2,  33.6, 41.1, "33.6~41.1"],
    ["bmr",           1529,  1462, 1704, "1462~1704"],
    ["ac",            28.9,  null, null, ""],
    ["amc",           24.8,  null, null, ""],
    ["inbody_score",  74,    null, null, ""],
    ["arm_r",         2.78,  null, null, ""],
    ["arm_r_p",       88.4,  null, null, ""],
    ["arm_l",         2.75,  null, null, ""],
    ["arm_l_p",       87.5,  null, null, ""],
    ["trunk",         23.2,  null, null, ""],
    ["trunk_p",       92.6,  null, null, ""],
    ["leg_r",         8.78,  null, null, ""],
    ["leg_r_p",       100.4, null, null, ""],
    ["leg_l",         8.79,  null, null, ""],
    ["leg_l_p",       100.5, null, null, ""],
    ["target_weight", 67.4,  null, null, ""],
    ["adj_weight",    1.3,   null, null, ""],
    ["adj_fat",       -2.3,  null, null, ""],
    ["adj_muscle",    3.6,   null, null, ""]
  ]') v
   WHERE e.kind = 'inbody' AND e.exam_date = '2026-04-30'
     AND e.user_id = (SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1);

-- ── 6. 2024 인바디에도 체중조절 목표를 값으로 옮긴다 ──────────────────
-- 011 에서는 회차 메모에 글로만 적어 두었다. 값으로 두어야 2026년 것과 선이 이어진다.
INSERT OR IGNORE INTO health_results (user_id, exam_id, code, value_num, value_text, created_at)
  SELECT e.user_id, e.id,
         json_extract(v.value, '$[0]'), json_extract(v.value, '$[1]'), '', datetime('now')
    FROM health_exams e,
         json_each('[
    ["target_weight", 67.2],
    ["adj_weight",    2.2],
    ["adj_fat",       -2.5],
    ["adj_muscle",    4.7]
  ]') v
   WHERE e.kind = 'inbody' AND e.exam_date = '2024-09-10'
     AND e.user_id = (SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1);
