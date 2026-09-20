-- 013 — 2025년 종합검진 · 그 사이에 잰 혈액검사와 인바디 전부
--
--   npx wrangler d1 execute japis-db --remote --file=./migrations/013_health_2025.sql
--
-- ── 무엇이 들어오나 ────────────────────────────────────────────────────
--
--   종합검진 1회   2025-09-02  SCL 하나로리더스헬스케어 (병원이 바뀌었다)
--   혈액검사 4회   2023-03-10 · 2023-06-27(헌혈) · 2024-07-24 · 2024-12-04
--   인바디  10회   2024-11-29 ~ 2026-03-03 (그 중 한 번은 ACCUNIQ)
--
-- ── 병원이 바뀌면 무엇이 달라지나 ──────────────────────────────────────
--
-- 2025년 검진은 강북삼성이 아니라 SCL 이다. 결과지의 생김새가 달라진 것은
-- 문제가 아니다 — 코드로 모으면 그만이다. 문제는 **참고범위가 통째로 다르다**는
-- 것이다(ALT 강북삼성 ~35 · SCL 1~40, 요산 2.8~8.2 · 3.4~7.0). 그래서 이 회차는
-- 행마다 그 검사실의 범위를 적어 넣는다. 화면의 판정이 결과지의 ▲▼ 와 어긋나면
-- 그 화면은 그날로 못 믿을 것이 된다.
--
-- ── 기기가 바뀌면 코드를 나눈다 ────────────────────────────────────────
--
-- 2025-09-02 체성분은 InBody 가 아니라 ACCUNIQ X-SCAN 이다. 대부분의 항목은
-- 같은 것을 재므로 같은 코드에 담는다(기기 차이는 provider 에 남는다). 딱 하나,
-- **골격근은 정의 자체가 다르다** — InBody 는 30kg 대, ACCUNIQ 는 20kg 대로
-- 나온다. 한 선에 이으면 근육이 3분의 1 날아간 그래프가 그려진다. 코드를 나눈다.
-- (eGFR 을 MDRD·CKD-EPI 로 나눈 것과 같은 이유다.)

-- ── 새 검사항목 이름표 ────────────────────────────────────────────────
INSERT OR REPLACE INTO health_metrics
  (code, name_ko, name_en, unit, category, sort_order, ref_low, ref_high, ref_text, direction, value_type, lab_group, memo)
VALUES
-- 혈액 — SCL 결과지에 있는데 010~012 가 몰랐던 것
('pct',            '혈소판용적률',      'PCT',                  '%',      'blood',   125, 0.15, 0.45, '0.15~0.45', 'mid',  'num', NULL,    ''),
('transferrin',    '혈청철포화도',      'Transferrin',          'mg/dL',  'blood',    75, 200,  360,  '200~360',   'mid',  'num', NULL,    ''),
('chloride',       '염소',              'Chloride',             'mmol/L', 'mineral',  45, 98,   107,  '98~107',    'mid',  'num', NULL,    ''),
('amylase',        '아밀라제',          'Amylase',              'U/L',    'liver',    76, 28,   100,  '28~100',    'mid',  'num', 'blood', '췌장이 내는 소화효소'),
('homa_ir',        '인슐린저항성',      'HOMA-IR',              '',       'sugar',    35, NULL, 2.4,  '≤ 2.4',     'low',  'num', 'blood', '높으면 인슐린이 잘 듣지 않는다'),
('testosterone_ng','테스토스테론',      'Testosterone',         'ng/mL',  'hormone',  12, NULL, NULL, '',          'mid',  'num', NULL,    'nmol/L 로 재는 곳과 단위가 다르다'),
('rf_quant',       '류마티스인자(정량)','RA quantitative',      'IU/mL',  'inflam',   35, NULL, 14.0, '0~14',      'low',  'num', NULL,    ''),
('hiv',            'HIV 항체',          'HIV Ab',               '',       'inflam',   25, NULL, NULL, '~음성',     'none', 'text', NULL,   ''),
('malaria',        '말라리아 항체',     'Malaria Ab',           '',       'inflam',   26, NULL, NULL, '~음성',     'none', 'text', NULL,   ''),
('htlv',           'HTLV 항체',         'HTLV Ab',              '',       'inflam',   27, NULL, NULL, '~음성',     'none', 'text', NULL,   ''),
('usg_thyroid',    '갑상선초음파',      'Thyroid USG',          '',       'sugar',    65, NULL, NULL, '',          'none', 'text', NULL,   ''),
('usg_aorta',      '복부대동맥초음파',  'Abdominal aorta USG',  '',       'lipid',   185, NULL, NULL, '',          'none', 'text', NULL,   ''),
('usg_pelvis',     '하복부초음파',      'Pelvic USG',           '',       'cancer',   75, NULL, NULL, '',          'none', 'text', NULL,   '남성은 전립선'),
('mri_pancreas',   '췌장 MRI',          'Pancreas screening MRI','',      'cancer',   45, NULL, NULL, '',          'none', 'text', NULL,   ''),
('mental_score',   '정신건강 종합지수', 'Mental health index',  '',       'stress',  115, NULL, 50,   '~50',       'low',  'num', NULL,    '낮을수록 좋다(참고값 50)'),
-- 체성분 — 기기가 다르면 코드도 다르다
('smm_accuniq',    '골격근(ACCUNIQ)',   'Skeletal muscle(X-SCAN)','kg',   'composition', 25, NULL, NULL, '',        'high', 'num', 'inbody', 'InBody 골격근량과 정의가 달라 같은 선에 두지 않는다'),
('vfl',            '내장지방레벨',      'Visceral fat level',   '',       'composition', 102, NULL, 10,  '~10',     'low',  'num', 'inbody', ''),
('vfat_kg',        '내장지방량',        'Visceral fat mass',    'kg',     'composition', 104, NULL, NULL, '',        'low',  'num', 'inbody', ''),
('subfat_kg',      '피하지방량',        'Subcutaneous fat mass','kg',     'composition', 106, NULL, NULL, '',        'low',  'num', 'inbody', ''),
('body_age',       '신체나이',          'Body age',             '세',     'composition', 190, NULL, NULL, '',        'low',  'num', 'inbody', '기기가 체성분으로 셈한 나이'),
('daily_kcal',     '1일 필요열량',      'Daily calorie need',   'kcal',   'composition', 122, NULL, NULL, '',        'none', 'num', 'inbody', '');

-- ══════════════════════════════════════════════════════════════════════
-- 2025-09-02 종합검진 — SCL 하나로리더스헬스케어
-- ══════════════════════════════════════════════════════════════════════
-- 참고범위를 행마다 적는다. 이 검사실의 기준이 강북삼성과 다르다.
INSERT OR IGNORE INTO health_exams (user_id, exam_date, kind, provider, title, memo, created_at, updated_at)
  SELECT id, '2025-09-02', 'checkup', 'SCL 하나로리더스헬스케어', '2025년 종합건강검진',
         '병원이 강북삼성에서 SCL 로 바뀐 해. 좌측 경동맥 비석회성 플라크(1.4mm) 새 소견 · 요추 골량감소증(T −1.5) · LDL 136 상승 · 당화혈색소 6.0 당뇨전단계 · 테스토스테론 상승(추적 권고).', datetime('now'), datetime('now')
    FROM users WHERE role = 'admin' ORDER BY id LIMIT 1;

INSERT OR IGNORE INTO health_results
  (user_id, exam_id, code, value_num, value_text, ref_low, ref_high, ref_text, created_at)
  SELECT e.user_id, e.id,
         json_extract(v.value, '$[0]'),
         json_extract(v.value, '$[1]'),
         COALESCE(json_extract(v.value, '$[2]'), ''),
         json_extract(v.value, '$[3]'),
         json_extract(v.value, '$[4]'),
         COALESCE(json_extract(v.value, '$[5]'), ''),
         datetime('now')
    FROM health_exams e,
         json_each('[
    ["height", 175.0, null, null, null, ""],
    ["weight", 64.5, null, null, null, ""],
    ["bmi", 21.1, null, 18.5, 24.9, "18.5~24.9"],
    ["target_weight", 67.5, null, null, null, ""],
    ["sbp", 110, null, null, 140, "~140"],
    ["dbp", 61, null, 60, null, "60~"],
    ["hr", 43, null, 60, 90, "60~90"],
    ["ecg", null, "동서맥 (정상에 비해 맥박이 느림)", null, null, ""],
    ["tchol", 217, null, 1, 199, "1~199"],
    ["hdl", 61, null, 40, 60, "40~60"],
    ["ldl", 136, null, 0, 129, "0~129"],
    ["tg", 98, null, 1, 149, "1~149"],
    ["ldh", 157, null, 0, 250, "0~250"],
    ["ck", 99, null, 39, 308, "39~308"],
    ["carotid", null, "좌측 경동맥 비석회성 플라크 1.4mm — 1년 후 추적", null, null, ""],
    ["usg_aorta", null, "정상", null, null, ""],
    ["glucose", 97, null, 70, 99, "70~99"],
    ["hba1c", 6.0, null, 1, 5.6, "1~5.6"],
    ["insulin", 3.3, null, 2.6, 24.9, "2.6~24.9"],
    ["homa_ir", 0.79, null, null, 2.4, "≤ 2.4"],
    ["tsh", 1.4, null, 0.27, 4.2, "0.27~4.20"],
    ["ft4", 1.16, null, 0.92, 1.68, "0.92~1.68"],
    ["usg_thyroid", null, "정상", null, null, ""],
    ["tp", 6.8, null, 6.6, 8.7, "6.6~8.7"],
    ["alb", 4.5, null, 3.5, 5.2, "3.5~5.2"],
    ["glob", 2.3, null, 2.3, 3.8, "2.3~3.8"],
    ["ag", 1.9, null, 1.0, 2.1, "1.0~2.1"],
    ["alp", 51, null, 40, 130, "40~130"],
    ["tbil", 0.56, null, 0.1, 1.2, "0.1~1.2"],
    ["dbil", 0.25, null, 0.0, 0.3, "0.00~0.30"],
    ["idbil", 0.31, null, 0.3, 1.0, "0.3~1.0"],
    ["ast", 19, null, 1, 40, "1~40"],
    ["alt", 25, null, 1, 40, "1~40"],
    ["ggtp", 53, null, 10, 71, "10~71"],
    ["amylase", 60, null, 28, 100, "28~100"],
    ["hbsag", 0.397, "음성 (0.397)", null, null, "< 0.900 COI"],
    ["hbsab", 60.5, "양성 (60.500)", null, null, "≥ 10.000 IU/L 면 양성"],
    ["havab", 0.01, "양성 (0.010)", null, null, "≤ 1.00 COI 면 양성"],
    ["usg_abd", null, "정상 (간·담낭·췌장·신장·비장)", null, null, ""],
    ["bun", 13.1, null, 6.0, 20.0, "6.0~20.0"],
    ["creatinine", 0.94, null, 0.7, 1.2, "0.7~1.2"],
    ["egfr", 92, null, 60, null, "> 60"],
    ["u_sg", 1.018, null, 1.005, 1.03, "1.005~1.030"],
    ["u_ph", 7.0, null, 4.6, 8.0, "4.6~8.0"],
    ["u_protein", null, "음성", null, null, ""],
    ["u_glucose", null, "음성", null, null, ""],
    ["u_ketone", null, "음성", null, null, ""],
    ["u_blood", null, "음성", null, null, ""],
    ["u_bilirubin", null, "음성", null, null, ""],
    ["u_urobilinogen", null, "Trace (+-)", null, null, ""],
    ["u_nitrite", null, "음성", null, null, ""],
    ["u_rbc", null, "0-3", null, null, "0~3 /HPF"],
    ["u_wbc", null, "0-5", null, null, "0~5 /HPF"],
    ["u_epi", null, "0", null, null, "0~5 /HPF"],
    ["uric_acid", 3.0, null, 3.4, 7.0, "3.4~7.0"],
    ["sodium", 145, null, 136.0, 145.0, "136~145"],
    ["potassium", 4.3, null, 3.5, 5.1, "3.5~5.1"],
    ["chloride", 106, null, 98.0, 107.0, "98~107"],
    ["phosphorus", 3.3, null, 2.5, 4.5, "2.5~4.5"],
    ["calcium", 9.4, null, 8.9, 10.4, "8.9~10.4"],
    ["magnesium", 2.2, null, 1.6, 2.6, "1.6~2.6"],
    ["wbc", 5.6, null, 4.0, 10.0, "4.0~10.0"],
    ["rbc", 4.36, null, 4.2, 6.3, "4.20~6.30"],
    ["hb", 14.0, null, 13.0, 17.0, "13.0~17.0"],
    ["hct", 42.1, null, 39.0, 52.0, "39.0~52.0"],
    ["mcv", 96.6, null, 79.0, 96.0, "79.0~96.0"],
    ["mch", 32.1, null, 26.0, 33.0, "26.0~33.0"],
    ["mchc", 33.3, null, 32.0, 37.0, "32.0~37.0"],
    ["rdw", 12.3, null, 10.9, 15.7, "10.9~15.7"],
    ["platelet", 285, null, 150, 450, "150~450"],
    ["pct", 0.28, null, 0.15, 0.45, "0.15~0.45"],
    ["mpv", 9.6, null, 9.3, 13.0, "9.3~13.0"],
    ["pdw", 10.5, null, 9.7, 18.5, "9.7~18.5"],
    ["neutrophil", 67.0, null, 40.0, 80.0, "40~80"],
    ["lymphocyte", 22.8, null, 15.0, 44.0, "15~44"],
    ["monocyte", 8.1, null, 2.0, 10.0, "2~10"],
    ["eosinophil", 1.4, null, 0, 5.0, "0~5"],
    ["basophil", 0.7, null, 0, 2, "0~2"],
    ["iron", 134, null, 33.0, 193.0, "33~193"],
    ["tibc", 327, null, 235, 461, "235~461"],
    ["transferrin", 256, null, 200, 360, "200~360"],
    ["rf_quant", 6.1, null, 0.0, 14.0, "0.0~14.0"],
    ["rpr", null, "음성", null, null, ""],
    ["hiv", null, "음성", null, null, ""],
    ["testosterone_ng", 8.05, null, 1.93, 7.4, "≥50세 1.930~7.400"],
    ["bmd_lumbar", null, "요추 L1-L4 T-score −1.5 · 골량감소증 (DEXA)", null, null, ""],
    ["bmd_l1l4_t", -1.5, null, -1.0, null, "-1.0~"],
    ["cxr", null, "정상범주", null, null, ""],
    ["cotinine", null, "음성", null, null, ""],
    ["egd", null, "미란성위염 (전정부 다발성 미란)", null, null, ""],
    ["occult", null, "음성", null, null, ""],
    ["cea", 2.1, null, 0, 3.8, "0~3.8"],
    ["ca199", 7.3, null, 0, 33.9, "0~33.9"],
    ["afp", 2.8, null, 0, 7.0, "0~7.0"],
    ["psa", 1.11, null, 0, 3.999, "0~3.999"],
    ["usg_pelvis", null, "정상 (전립선)", null, null, ""],
    ["mri_pancreas", null, "정상범주 — 국소 병변·췌관 확장 없음", null, null, ""],
    ["eye_r", 0.1, null, null, null, ""],
    ["eye_l", 1.0, null, null, null, ""],
    ["fundus", null, "정상", null, null, ""],
    ["stress_res", 150, null, 90, 150, "90~150"],
    ["stress_index", 58, null, null, null, ""],
    ["fatigue", 93.9, null, null, null, ""],
    ["hrv_hr", 43, null, 60, 90, "60~90"],
    ["cardiac_stab", 126.7, null, 90, 150, "90~150"],
    ["ans_activity", 114.1, null, 90, 150, "90~150"],
    ["ans_balance", 53.6, null, null, 50, "0~50"],
    ["mental_score", 24, null, null, 50, "~50"],
    ["age_real", 53, null, null, null, ""]
  ]') v
   WHERE e.kind = 'checkup' AND e.exam_date = '2025-09-02'
     AND e.user_id = (SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1);

-- ══════════════════════════════════════════════════════════════════════
-- 혈액검사 — 검진과 검진 사이
-- ══════════════════════════════════════════════════════════════════════
INSERT OR IGNORE INTO health_exams (user_id, exam_date, kind, provider, title, memo, created_at, updated_at)
  SELECT id, '2023-03-10', 'blood', '삼성SDS 부속의원 (GC Labs)', '혈액검사',
         '총콜레스테롤 216·LDL 149 높음, 당화혈색소 6.2 (당뇨고위험군), 요산 3.2 낮음.', datetime('now'), datetime('now')
    FROM users WHERE role = 'admin' ORDER BY id LIMIT 1;

INSERT OR IGNORE INTO health_results
  (user_id, exam_id, code, value_num, value_text, ref_low, ref_high, ref_text, created_at)
  SELECT e.user_id, e.id,
         json_extract(v.value, '$[0]'),
         json_extract(v.value, '$[1]'),
         COALESCE(json_extract(v.value, '$[2]'), ''),
         json_extract(v.value, '$[3]'),
         json_extract(v.value, '$[4]'),
         COALESCE(json_extract(v.value, '$[5]'), ''),
         datetime('now')
    FROM health_exams e,
         json_each('[
    ["ast", 21, null, 0, 40, "0~40"],
    ["alt", 17, null, 0, 41, "0~41"],
    ["alp", 47, null, 40, 129, "40~129"],
    ["ggtp", 38, null, 10, 71, "10~71"],
    ["glucose", 95, null, 70, 99, "70~99"],
    ["tbil", 0.8, null, 0.0, 1.2, "0.0~1.2"],
    ["dbil", 0.3, null, 0.0, 0.3, "0.0~0.3"],
    ["bun", 15, null, 6, 20, "6~20"],
    ["creatinine", 1.04, null, 0.7, 1.2, "0.70~1.20"],
    ["uric_acid", 3.2, null, 3.4, 7.0, "3.4~7.0"],
    ["hba1c", 6.2, null, null, 5.6, "≤ 5.6"],
    ["hba1c_ifcc", 44, null, null, 38, "≤ 38"],
    ["eag", 131, null, null, null, ""],
    ["tchol", 216, null, null, 199, "< 200"],
    ["hdl", 52, null, 40, null, "40~"],
    ["ldl", 149, null, null, 129, "< 130"],
    ["tg", 97, null, null, 149, "< 150"],
    ["egfr_mdrd", 76, null, 60, null, "60~"]
  ]') v
   WHERE e.kind = 'blood' AND e.exam_date = '2023-03-10'
     AND e.user_id = (SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1);

INSERT OR IGNORE INTO health_exams (user_id, exam_date, kind, provider, title, memo, created_at, updated_at)
  SELECT id, '2023-06-27', 'blood', '대한산업보건협회 한마음혈액원 (헌혈)', '헌혈 혈액검사',
         '헌혈하고 받은 결과지. 수혈자 안전을 위해 민감도를 높게 맞춘 검사라, 결과지 스스로 건강검진 대용으로 쓰지 말라고 적어 두었다.', datetime('now'), datetime('now')
    FROM users WHERE role = 'admin' ORDER BY id LIMIT 1;

INSERT OR IGNORE INTO health_results
  (user_id, exam_id, code, value_num, value_text, ref_low, ref_high, ref_text, created_at)
  SELECT e.user_id, e.id,
         json_extract(v.value, '$[0]'),
         json_extract(v.value, '$[1]'),
         COALESCE(json_extract(v.value, '$[2]'), ''),
         json_extract(v.value, '$[3]'),
         json_extract(v.value, '$[4]'),
         COALESCE(json_extract(v.value, '$[5]'), ''),
         datetime('now')
    FROM health_exams e,
         json_each('[
    ["height", 175, null, null, null, ""],
    ["weight", 65, null, null, null, ""],
    ["bmi", 21.2, null, 18.5, 22.9, "18.5~22.9"],
    ["sbp", 109, null, null, 140, "~140"],
    ["dbp", 63, null, 60, null, "60~"],
    ["hb", 13.3, null, 13.0, 17.0, "13.0~17.0"],
    ["ast", 19, null, null, 40, "≤ 40"],
    ["alt", 15, null, null, 45, "≤ 45"],
    ["ggtp", 30, null, null, 63, "≤ 63"],
    ["tp", 6.7, null, 6.6, 8.8, "6.6~8.8"],
    ["alb", 4.33, null, 3.5, 5.2, "3.5~5.2"],
    ["tchol", 212, null, null, 199, "< 200"],
    ["creatinine", 1, null, null, 1.5, "≤ 1.5"],
    ["uric_acid", 2.9, null, 2.6, 7.0, "2.6~7.0"],
    ["hbsag", null, "음성", null, null, ""],
    ["hcvab", null, "음성", null, null, ""],
    ["rpr", null, "음성", null, null, ""],
    ["malaria", null, "음성", null, null, ""],
    ["htlv", null, "음성", null, null, ""]
  ]') v
   WHERE e.kind = 'blood' AND e.exam_date = '2023-06-27'
     AND e.user_id = (SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1);

INSERT OR IGNORE INTO health_exams (user_id, exam_date, kind, provider, title, memo, created_at, updated_at)
  SELECT id, '2024-07-24', 'blood', '삼성SDS 부속의원 (GC Labs)', '혈액검사',
         '총콜레스테롤 227·LDL 163 높음, 공복혈당 105, 당화혈색소 6.0. HDL 43 으로 이 기간 중 가장 낮다.', datetime('now'), datetime('now')
    FROM users WHERE role = 'admin' ORDER BY id LIMIT 1;

INSERT OR IGNORE INTO health_results
  (user_id, exam_id, code, value_num, value_text, ref_low, ref_high, ref_text, created_at)
  SELECT e.user_id, e.id,
         json_extract(v.value, '$[0]'),
         json_extract(v.value, '$[1]'),
         COALESCE(json_extract(v.value, '$[2]'), ''),
         json_extract(v.value, '$[3]'),
         json_extract(v.value, '$[4]'),
         COALESCE(json_extract(v.value, '$[5]'), ''),
         datetime('now')
    FROM health_exams e,
         json_each('[
    ["ast", 19, null, 0, 40, "0~40"],
    ["alt", 13, null, 0, 41, "0~41"],
    ["ldh", 182, null, 135, 225, "135~225"],
    ["alp", 47, null, 40, 129, "40~129"],
    ["ck", 107, null, null, 190, "< 190"],
    ["ggtp", 22, null, 10, 71, "10~71"],
    ["glucose", 105, null, 70, 99, "70~99"],
    ["tbil", 0.6, null, 0.0, 1.2, "0.0~1.2"],
    ["dbil", 0.2, null, 0.0, 0.3, "0.0~0.3"],
    ["bun", 16, null, 6, 20, "6~20"],
    ["creatinine", 0.96, null, 0.7, 1.2, "0.70~1.20"],
    ["uric_acid", 3.6, null, 3.4, 7.0, "3.4~7.0"],
    ["hba1c", 6.0, null, null, 5.6, "≤ 5.6"],
    ["hba1c_ifcc", 42, null, null, 38, "≤ 38"],
    ["eag", 126, null, null, null, ""],
    ["tchol", 227, null, null, 199, "< 200"],
    ["hdl", 43, null, 40, null, "40~"],
    ["ldl", 163, null, null, 129, "< 130"],
    ["tg", 133, null, null, 149, "< 150"],
    ["egfr_mdrd", 83, null, 60, null, "60~"]
  ]') v
   WHERE e.kind = 'blood' AND e.exam_date = '2024-07-24'
     AND e.user_id = (SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1);

INSERT OR IGNORE INTO health_exams (user_id, exam_date, kind, provider, title, memo, created_at, updated_at)
  SELECT id, '2024-12-04', 'blood', '삼성SDS 부속의원 (GC Labs)', '혈액검사',
         '지질이 이 기간 중 가장 좋았던 회차 — 총콜레스테롤 186·LDL 126 으로 둘 다 범위 안. 요산 3.1 낮음.', datetime('now'), datetime('now')
    FROM users WHERE role = 'admin' ORDER BY id LIMIT 1;

INSERT OR IGNORE INTO health_results
  (user_id, exam_id, code, value_num, value_text, ref_low, ref_high, ref_text, created_at)
  SELECT e.user_id, e.id,
         json_extract(v.value, '$[0]'),
         json_extract(v.value, '$[1]'),
         COALESCE(json_extract(v.value, '$[2]'), ''),
         json_extract(v.value, '$[3]'),
         json_extract(v.value, '$[4]'),
         COALESCE(json_extract(v.value, '$[5]'), ''),
         datetime('now')
    FROM health_exams e,
         json_each('[
    ["ast", 24, null, 0, 40, "0~40"],
    ["alt", 18, null, 0, 41, "0~41"],
    ["ldh", 195, null, 135, 225, "135~225"],
    ["alp", 51, null, 40, 129, "40~129"],
    ["ck", 176, null, null, 190, "< 190"],
    ["ggtp", 37, null, 10, 71, "10~71"],
    ["glucose", 101, null, 70, 99, "70~99"],
    ["tbil", 0.6, null, 0.0, 1.2, "0.0~1.2"],
    ["dbil", 0.2, null, 0.0, 0.3, "0.0~0.3"],
    ["bun", 15, null, 6, 20, "6~20"],
    ["creatinine", 1.0, null, 0.7, 1.2, "0.70~1.20"],
    ["uric_acid", 3.1, null, 3.4, 7.0, "3.4~7.0"],
    ["hba1c", 5.9, null, null, 5.6, "≤ 5.6"],
    ["hba1c_ifcc", 41, null, null, 38, "≤ 38"],
    ["eag", 123, null, null, null, ""],
    ["tchol", 186, null, null, 199, "< 200"],
    ["hdl", 57, null, 40, null, "40~"],
    ["ldl", 126, null, null, 129, "< 130"],
    ["tg", 67, null, null, 149, "< 150"],
    ["egfr_mdrd", 78, null, 60, null, "60~"]
  ]') v
   WHERE e.kind = 'blood' AND e.exam_date = '2024-12-04'
     AND e.user_id = (SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1);

-- ══════════════════════════════════════════════════════════════════════
-- 인바디 — 회사에 놓인 기계로 두세 달에 한 번씩 잰 것
-- ══════════════════════════════════════════════════════════════════════
INSERT OR IGNORE INTO health_exams (user_id, exam_date, kind, provider, title, memo, created_at, updated_at)
  SELECT id, '2024-11-29', 'inbody', '삼성SDS (InBody 720)', '인바디 (InBody 75점)',
         '체지방 10.6kg · 체지방률 16.6% 로 이 기간 중 낮은 축.', datetime('now'), datetime('now')
    FROM users WHERE role = 'admin' ORDER BY id LIMIT 1;

INSERT OR IGNORE INTO health_results
  (user_id, exam_id, code, value_num, value_text, ref_low, ref_high, ref_text, created_at)
  SELECT e.user_id, e.id,
         json_extract(v.value, '$[0]'),
         json_extract(v.value, '$[1]'),
         COALESCE(json_extract(v.value, '$[2]'), ''),
         json_extract(v.value, '$[3]'),
         json_extract(v.value, '$[4]'),
         COALESCE(json_extract(v.value, '$[5]'), ''),
         datetime('now')
    FROM health_exams e,
         json_each('[
    ["height", 175, null, null, null, ""],
    ["weight", 63.8, null, 57.3, 77.5, "57.3~77.5"],
    ["bmi", 20.8, null, 18.5, 23.0, "18.5~23.0"],
    ["icw", 24.6, null, 23.5, 28.7, "23.5~28.7"],
    ["ecw_vol", 14.4, null, 14.4, 17.6, "14.4~17.6"],
    ["tbw", 39.0, null, null, null, ""],
    ["protein", 10.6, null, 10.2, 12.4, "10.2~12.4"],
    ["mineral_mass", 3.64, null, 3.5, 4.28, "3.50~4.28"],
    ["bmc", 2.99, null, 2.89, 3.53, "2.89~3.53"],
    ["fatmass", 10.6, null, 8.1, 16.2, "8.1~16.2"],
    ["slm", 50.2, null, null, null, ""],
    ["ffm", 53.2, null, null, null, ""],
    ["smm", 30.1, null, 28.8, 35.2, "28.8~35.2"],
    ["bodyfat", 16.6, null, 10.0, 20.0, "10.0~20.0"],
    ["fatdist", 0.83, null, 0.8, 0.9, "0.80~0.90"],
    ["vfa", 38.8, null, null, 100, "~100"],
    ["ecw", 0.369, null, 0.36, 0.39, "0.360~0.390"],
    ["ecf_tbf", 0.322, null, null, null, ""],
    ["obesity_deg", 94, null, 90, 110, "90~110"],
    ["bcm", 35.2, null, 33.6, 41.1, "33.6~41.1"],
    ["bmr", 1519, null, 1424, 1658, "1424~1658"],
    ["ac", 28.6, null, null, null, ""],
    ["amc", 24.6, null, null, null, ""],
    ["inbody_score", 75, null, null, null, ""],
    ["arm_r", 2.75, null, null, null, ""],
    ["arm_r_p", 90.5, null, null, null, ""],
    ["arm_l", 2.74, null, null, null, ""],
    ["arm_l_p", 90.2, null, null, null, ""],
    ["trunk", 23.2, null, null, null, ""],
    ["trunk_p", 95.7, null, null, null, ""],
    ["leg_r", 8.73, null, null, null, ""],
    ["leg_r_p", 103.5, null, null, null, ""],
    ["leg_l", 8.49, null, null, null, ""],
    ["leg_l_p", 100.6, null, null, null, ""],
    ["target_weight", 67.4, null, null, null, ""],
    ["adj_weight", 3.6, null, null, null, ""],
    ["adj_fat", -0.5, null, null, null, ""],
    ["adj_muscle", 4.1, null, null, null, ""]
  ]') v
   WHERE e.kind = 'inbody' AND e.exam_date = '2024-11-29'
     AND e.user_id = (SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1);

INSERT OR IGNORE INTO health_exams (user_id, exam_date, kind, provider, title, memo, created_at, updated_at)
  SELECT id, '2024-12-27', 'inbody', '삼성SDS (InBody 720)', '인바디 (InBody 76점)',
         '', datetime('now'), datetime('now')
    FROM users WHERE role = 'admin' ORDER BY id LIMIT 1;

INSERT OR IGNORE INTO health_results
  (user_id, exam_id, code, value_num, value_text, ref_low, ref_high, ref_text, created_at)
  SELECT e.user_id, e.id,
         json_extract(v.value, '$[0]'),
         json_extract(v.value, '$[1]'),
         COALESCE(json_extract(v.value, '$[2]'), ''),
         json_extract(v.value, '$[3]'),
         json_extract(v.value, '$[4]'),
         COALESCE(json_extract(v.value, '$[5]'), ''),
         datetime('now')
    FROM health_exams e,
         json_each('[
    ["height", 175, null, null, null, ""],
    ["weight", 64.1, null, 57.3, 77.5, "57.3~77.5"],
    ["bmi", 20.9, null, 18.5, 23.0, "18.5~23.0"],
    ["icw", 24.8, null, 23.5, 28.7, "23.5~28.7"],
    ["ecw_vol", 14.5, null, 14.4, 17.6, "14.4~17.6"],
    ["tbw", 39.3, null, null, null, ""],
    ["protein", 10.7, null, 10.2, 12.4, "10.2~12.4"],
    ["mineral_mass", 3.75, null, 3.5, 4.28, "3.50~4.28"],
    ["bmc", 3.01, null, 2.89, 3.53, "2.89~3.53"],
    ["fatmass", 10.4, null, 8.1, 16.2, "8.1~16.2"],
    ["slm", 50.6, null, null, null, ""],
    ["ffm", 53.7, null, null, null, ""],
    ["smm", 30.3, null, 28.8, 35.2, "28.8~35.2"],
    ["bodyfat", 16.3, null, 10.0, 20.0, "10.0~20.0"],
    ["fatdist", 0.82, null, 0.8, 0.9, "0.80~0.90"],
    ["vfa", 38.7, null, null, 100, "~100"],
    ["ecw", 0.37, null, 0.36, 0.39, "0.360~0.390"],
    ["ecf_tbf", 0.324, null, null, null, ""],
    ["obesity_deg", 95, null, 90, 110, "90~110"],
    ["bcm", 35.5, null, 33.6, 41.1, "33.6~41.1"],
    ["bmr", 1528, null, 1429, 1664, "1429~1664"],
    ["ac", 28.4, null, null, null, ""],
    ["amc", 24.6, null, null, null, ""],
    ["inbody_score", 76, null, null, null, ""],
    ["arm_r", 2.76, null, null, null, ""],
    ["arm_r_p", 90.5, null, null, null, ""],
    ["arm_l", 2.74, null, null, null, ""],
    ["arm_l_p", 89.9, null, null, null, ""],
    ["trunk", 23.2, null, null, null, ""],
    ["trunk_p", 95.2, null, null, null, ""],
    ["leg_r", 8.76, null, null, null, ""],
    ["leg_r_p", 103.4, null, null, null, ""],
    ["leg_l", 8.59, null, null, null, ""],
    ["leg_l_p", 101.3, null, null, null, ""],
    ["target_weight", 67.4, null, null, null, ""],
    ["adj_weight", 3.3, null, null, null, ""],
    ["adj_fat", -0.3, null, null, null, ""],
    ["adj_muscle", 3.6, null, null, null, ""]
  ]') v
   WHERE e.kind = 'inbody' AND e.exam_date = '2024-12-27'
     AND e.user_id = (SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1);

INSERT OR IGNORE INTO health_exams (user_id, exam_date, kind, provider, title, memo, created_at, updated_at)
  SELECT id, '2025-01-24', 'inbody', '삼성SDS (InBody 720)', '인바디 (InBody 76점)',
         '', datetime('now'), datetime('now')
    FROM users WHERE role = 'admin' ORDER BY id LIMIT 1;

INSERT OR IGNORE INTO health_results
  (user_id, exam_id, code, value_num, value_text, ref_low, ref_high, ref_text, created_at)
  SELECT e.user_id, e.id,
         json_extract(v.value, '$[0]'),
         json_extract(v.value, '$[1]'),
         COALESCE(json_extract(v.value, '$[2]'), ''),
         json_extract(v.value, '$[3]'),
         json_extract(v.value, '$[4]'),
         COALESCE(json_extract(v.value, '$[5]'), ''),
         datetime('now')
    FROM health_exams e,
         json_each('[
    ["height", 175, null, null, null, ""],
    ["weight", 64.4, null, 57.3, 77.5, "57.3~77.5"],
    ["bmi", 21.0, null, 18.5, 23.0, "18.5~23.0"],
    ["icw", 24.8, null, 23.5, 28.7, "23.5~28.7"],
    ["ecw_vol", 14.5, null, 14.4, 17.6, "14.4~17.6"],
    ["tbw", 39.3, null, null, null, ""],
    ["protein", 10.7, null, 10.2, 12.4, "10.2~12.4"],
    ["mineral_mass", 3.74, null, 3.5, 4.28, "3.50~4.28"],
    ["bmc", 3.04, null, 2.89, 3.53, "2.89~3.53"],
    ["fatmass", 10.7, null, 8.1, 16.2, "8.1~16.2"],
    ["slm", 50.6, null, null, null, ""],
    ["ffm", 53.7, null, null, null, ""],
    ["smm", 30.3, null, 28.8, 35.2, "28.8~35.2"],
    ["bodyfat", 16.7, null, 10.0, 20.0, "10.0~20.0"],
    ["fatdist", 0.81, null, 0.8, 0.9, "0.80~0.90"],
    ["vfa", 38.8, null, null, 100, "~100"],
    ["ecw", 0.369, null, 0.36, 0.39, "0.360~0.390"],
    ["ecf_tbf", 0.323, null, null, null, ""],
    ["obesity_deg", 95, null, 90, 110, "90~110"],
    ["bcm", 35.5, null, 33.6, 41.1, "33.6~41.1"],
    ["bmr", 1529, null, 1434, 1670, "1434~1670"],
    ["ac", 28.5, null, null, null, ""],
    ["amc", 24.6, null, null, null, ""],
    ["inbody_score", 76, null, null, null, ""],
    ["arm_r", 2.68, null, null, null, ""],
    ["arm_r_p", 87.5, null, null, null, ""],
    ["arm_l", 2.75, null, null, null, ""],
    ["arm_l_p", 89.6, null, null, null, ""],
    ["trunk", 23.0, null, null, null, ""],
    ["trunk_p", 94.2, null, null, null, ""],
    ["leg_r", 8.92, null, null, null, ""],
    ["leg_r_p", 104.8, null, null, null, ""],
    ["leg_l", 8.67, null, null, null, ""],
    ["leg_l_p", 101.8, null, null, null, ""],
    ["target_weight", 67.4, null, null, null, ""],
    ["adj_weight", 3.0, null, null, null, ""],
    ["adj_fat", -0.6, null, null, null, ""],
    ["adj_muscle", 3.6, null, null, null, ""]
  ]') v
   WHERE e.kind = 'inbody' AND e.exam_date = '2025-01-24'
     AND e.user_id = (SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1);

INSERT OR IGNORE INTO health_exams (user_id, exam_date, kind, provider, title, memo, created_at, updated_at)
  SELECT id, '2025-02-28', 'inbody', '삼성SDS (InBody 720)', '인바디 (InBody 78점)',
         '이 기간의 꼭대기 — 골격근 31.4kg · 체지방률 14.7% · 인바디 78점 모두 최고치.', datetime('now'), datetime('now')
    FROM users WHERE role = 'admin' ORDER BY id LIMIT 1;

INSERT OR IGNORE INTO health_results
  (user_id, exam_id, code, value_num, value_text, ref_low, ref_high, ref_text, created_at)
  SELECT e.user_id, e.id,
         json_extract(v.value, '$[0]'),
         json_extract(v.value, '$[1]'),
         COALESCE(json_extract(v.value, '$[2]'), ''),
         json_extract(v.value, '$[3]'),
         json_extract(v.value, '$[4]'),
         COALESCE(json_extract(v.value, '$[5]'), ''),
         datetime('now')
    FROM health_exams e,
         json_each('[
    ["height", 175, null, null, null, ""],
    ["weight", 65.1, null, 57.3, 77.5, "57.3~77.5"],
    ["bmi", 21.3, null, 18.5, 23.0, "18.5~23.0"],
    ["icw", 25.6, null, 23.5, 28.7, "23.5~28.7"],
    ["ecw_vol", 15.1, null, 14.4, 17.6, "14.4~17.6"],
    ["tbw", 40.7, null, null, null, ""],
    ["protein", 11.1, null, 10.2, 12.4, "10.2~12.4"],
    ["mineral_mass", 3.87, null, 3.5, 4.28, "3.50~4.28"],
    ["bmc", 3.15, null, 2.89, 3.53, "2.89~3.53"],
    ["fatmass", 9.5, null, 8.1, 16.2, "8.1~16.2"],
    ["slm", 52.4, null, null, null, ""],
    ["ffm", 55.6, null, null, null, ""],
    ["smm", 31.4, null, 28.8, 35.2, "28.8~35.2"],
    ["bodyfat", 14.7, null, 10.0, 20.0, "10.0~20.0"],
    ["fatdist", 0.81, null, 0.8, 0.9, "0.80~0.90"],
    ["vfa", 34.5, null, null, 100, "~100"],
    ["ecw", 0.369, null, 0.36, 0.39, "0.360~0.390"],
    ["ecf_tbf", 0.323, null, null, null, ""],
    ["obesity_deg", 96, null, 90, 110, "90~110"],
    ["bcm", 36.7, null, 33.6, 41.1, "33.6~41.1"],
    ["bmr", 1569, null, 1445, 1684, "1445~1684"],
    ["ac", 28.7, null, null, null, ""],
    ["amc", 25.1, null, null, null, ""],
    ["inbody_score", 78, null, null, null, ""],
    ["arm_r", 2.86, null, null, null, ""],
    ["arm_r_p", 92.2, null, null, null, ""],
    ["arm_l", 2.9, null, null, null, ""],
    ["arm_l_p", 93.6, null, null, null, ""],
    ["trunk", 23.8, null, null, null, ""],
    ["trunk_p", 96.4, null, null, null, ""],
    ["leg_r", 8.91, null, null, null, ""],
    ["leg_r_p", 103.5, null, null, null, ""],
    ["leg_l", 8.77, null, null, null, ""],
    ["leg_l_p", 101.9, null, null, null, ""],
    ["target_weight", 67.4, null, null, null, ""],
    ["adj_weight", 2.3, null, null, null, ""],
    ["adj_fat", 0.6, null, null, null, ""],
    ["adj_muscle", 1.7, null, null, null, ""]
  ]') v
   WHERE e.kind = 'inbody' AND e.exam_date = '2025-02-28'
     AND e.user_id = (SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1);

INSERT OR IGNORE INTO health_exams (user_id, exam_date, kind, provider, title, memo, created_at, updated_at)
  SELECT id, '2025-06-04', 'inbody', '삼성SDS (InBody 720)', '인바디 (InBody 77점)',
         '', datetime('now'), datetime('now')
    FROM users WHERE role = 'admin' ORDER BY id LIMIT 1;

INSERT OR IGNORE INTO health_results
  (user_id, exam_id, code, value_num, value_text, ref_low, ref_high, ref_text, created_at)
  SELECT e.user_id, e.id,
         json_extract(v.value, '$[0]'),
         json_extract(v.value, '$[1]'),
         COALESCE(json_extract(v.value, '$[2]'), ''),
         json_extract(v.value, '$[3]'),
         json_extract(v.value, '$[4]'),
         COALESCE(json_extract(v.value, '$[5]'), ''),
         datetime('now')
    FROM health_exams e,
         json_each('[
    ["height", 175, null, null, null, ""],
    ["weight", 63.9, null, 57.3, 77.5, "57.3~77.5"],
    ["bmi", 20.9, null, 18.5, 23.0, "18.5~23.0"],
    ["icw", 25.0, null, 23.5, 28.7, "23.5~28.7"],
    ["ecw_vol", 14.8, null, 14.4, 17.6, "14.4~17.6"],
    ["tbw", 39.8, null, null, null, ""],
    ["protein", 10.8, null, 10.2, 12.4, "10.2~12.4"],
    ["mineral_mass", 3.65, null, 3.5, 4.28, "3.50~4.28"],
    ["bmc", 3.05, null, 2.89, 3.53, "2.89~3.53"],
    ["fatmass", 9.6, null, 8.1, 16.2, "8.1~16.2"],
    ["slm", 51.3, null, null, null, ""],
    ["ffm", 54.3, null, null, null, ""],
    ["smm", 30.7, null, 28.8, 35.2, "28.8~35.2"],
    ["bodyfat", 15.0, null, 10.0, 20.0, "10.0~20.0"],
    ["fatdist", 0.81, null, 0.8, 0.9, "0.80~0.90"],
    ["vfa", 34.7, null, null, 100, "~100"],
    ["ecw", 0.371, null, 0.36, 0.39, "0.360~0.390"],
    ["ecf_tbf", 0.324, null, null, null, ""],
    ["obesity_deg", 94, null, 90, 110, "90~110"],
    ["bcm", 35.9, null, 33.6, 41.1, "33.6~41.1"],
    ["bmr", 1543, null, 1425, 1660, "1425~1660"],
    ["ac", 28.1, null, null, null, ""],
    ["amc", 24.6, null, null, null, ""],
    ["inbody_score", 77, null, null, null, ""],
    ["arm_r", 2.83, null, null, null, ""],
    ["arm_r_p", 93.0, null, null, null, ""],
    ["arm_l", 2.77, null, null, null, ""],
    ["arm_l_p", 91.2, null, null, null, ""],
    ["trunk", 23.4, null, null, null, ""],
    ["trunk_p", 96.4, null, null, null, ""],
    ["leg_r", 8.8, null, null, null, ""],
    ["leg_r_p", 104.2, null, null, null, ""],
    ["leg_l", 8.8, null, null, null, ""],
    ["leg_l_p", 104.2, null, null, null, ""],
    ["target_weight", 67.3, null, null, null, ""],
    ["adj_weight", 3.4, null, null, null, ""],
    ["adj_fat", -0.5, null, null, null, ""],
    ["adj_muscle", 2.9, null, null, null, ""]
  ]') v
   WHERE e.kind = 'inbody' AND e.exam_date = '2025-06-04'
     AND e.user_id = (SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1);

INSERT OR IGNORE INTO health_exams (user_id, exam_date, kind, provider, title, memo, created_at, updated_at)
  SELECT id, '2025-09-30', 'inbody', '삼성SDS (InBody 720)', '인바디 (InBody 75점)',
         '', datetime('now'), datetime('now')
    FROM users WHERE role = 'admin' ORDER BY id LIMIT 1;

INSERT OR IGNORE INTO health_results
  (user_id, exam_id, code, value_num, value_text, ref_low, ref_high, ref_text, created_at)
  SELECT e.user_id, e.id,
         json_extract(v.value, '$[0]'),
         json_extract(v.value, '$[1]'),
         COALESCE(json_extract(v.value, '$[2]'), ''),
         json_extract(v.value, '$[3]'),
         json_extract(v.value, '$[4]'),
         COALESCE(json_extract(v.value, '$[5]'), ''),
         datetime('now')
    FROM health_exams e,
         json_each('[
    ["height", 175, null, null, null, ""],
    ["weight", 65.0, null, 57.3, 77.5, "57.3~77.5"],
    ["bmi", 21.2, null, 18.5, 23.0, "18.5~23.0"],
    ["icw", 24.6, null, 23.5, 28.7, "23.5~28.7"],
    ["ecw_vol", 14.5, null, 14.4, 17.6, "14.4~17.6"],
    ["tbw", 39.1, null, null, null, ""],
    ["protein", 10.6, null, 10.2, 12.4, "10.2~12.4"],
    ["mineral_mass", 3.64, null, 3.5, 4.28, "3.50~4.28"],
    ["bmc", 2.98, null, 2.89, 3.53, "2.89~3.53"],
    ["fatmass", 11.6, null, 8.1, 16.2, "8.1~16.2"],
    ["slm", 50.4, null, null, null, ""],
    ["ffm", 53.4, null, null, null, ""],
    ["smm", 30.1, null, 28.8, 35.2, "28.8~35.2"],
    ["bodyfat", 17.9, null, 10.0, 20.0, "10.0~20.0"],
    ["fatdist", 0.83, null, 0.8, 0.9, "0.80~0.90"],
    ["vfa", 44.3, null, null, 100, "~100"],
    ["ecw", 0.371, null, 0.36, 0.39, "0.360~0.390"],
    ["ecf_tbf", 0.325, null, null, null, ""],
    ["obesity_deg", 96, null, 90, 110, "90~110"],
    ["bcm", 35.2, null, 33.6, 41.1, "33.6~41.1"],
    ["bmr", 1522, null, 1444, 1682, "1444~1682"],
    ["ac", 28.8, null, null, null, ""],
    ["amc", 24.8, null, null, null, ""],
    ["inbody_score", 75, null, null, null, ""],
    ["arm_r", 2.76, null, null, null, ""],
    ["arm_r_p", 89.3, null, null, null, ""],
    ["arm_l", 2.74, null, null, null, ""],
    ["arm_l_p", 88.6, null, null, null, ""],
    ["trunk", 23.2, null, null, null, ""],
    ["trunk_p", 94.1, null, null, null, ""],
    ["leg_r", 8.71, null, null, null, ""],
    ["leg_r_p", 101.3, null, null, null, ""],
    ["leg_l", 8.77, null, null, null, ""],
    ["leg_l_p", 102.0, null, null, null, ""],
    ["target_weight", 67.4, null, null, null, ""],
    ["adj_weight", 2.4, null, null, null, ""],
    ["adj_fat", -1.5, null, null, null, ""],
    ["adj_muscle", 3.9, null, null, null, ""]
  ]') v
   WHERE e.kind = 'inbody' AND e.exam_date = '2025-09-30'
     AND e.user_id = (SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1);

INSERT OR IGNORE INTO health_exams (user_id, exam_date, kind, provider, title, memo, created_at, updated_at)
  SELECT id, '2025-11-04', 'inbody', '삼성SDS (InBody 720)', '인바디 (InBody 74점)',
         '', datetime('now'), datetime('now')
    FROM users WHERE role = 'admin' ORDER BY id LIMIT 1;

INSERT OR IGNORE INTO health_results
  (user_id, exam_id, code, value_num, value_text, ref_low, ref_high, ref_text, created_at)
  SELECT e.user_id, e.id,
         json_extract(v.value, '$[0]'),
         json_extract(v.value, '$[1]'),
         COALESCE(json_extract(v.value, '$[2]'), ''),
         json_extract(v.value, '$[3]'),
         json_extract(v.value, '$[4]'),
         COALESCE(json_extract(v.value, '$[5]'), ''),
         datetime('now')
    FROM health_exams e,
         json_each('[
    ["height", 175, null, null, null, ""],
    ["weight", 66.1, null, 57.3, 77.5, "57.3~77.5"],
    ["bmi", 21.6, null, 18.5, 23.0, "18.5~23.0"],
    ["icw", 24.7, null, 23.5, 28.7, "23.5~28.7"],
    ["ecw_vol", 14.5, null, 14.4, 17.6, "14.4~17.6"],
    ["tbw", 39.2, null, null, null, ""],
    ["protein", 10.7, null, 10.2, 12.4, "10.2~12.4"],
    ["mineral_mass", 3.65, null, 3.5, 4.28, "3.50~4.28"],
    ["bmc", 3.03, null, 2.89, 3.53, "2.89~3.53"],
    ["fatmass", 12.6, null, 8.1, 16.2, "8.1~16.2"],
    ["slm", 50.5, null, null, null, ""],
    ["ffm", 53.5, null, null, null, ""],
    ["smm", 30.2, null, 28.8, 35.2, "28.8~35.2"],
    ["bodyfat", 19.0, null, 10.0, 20.0, "10.0~20.0"],
    ["fatdist", 0.85, null, 0.8, 0.9, "0.80~0.90"],
    ["vfa", 48.9, null, null, 100, "~100"],
    ["ecw", 0.369, null, 0.36, 0.39, "0.360~0.390"],
    ["ecf_tbf", 0.323, null, null, null, ""],
    ["obesity_deg", 98, null, 90, 110, "90~110"],
    ["bcm", 35.4, null, 33.6, 41.1, "33.6~41.1"],
    ["bmr", 1526, null, 1462, 1704, "1462~1704"],
    ["ac", 29.4, null, null, null, ""],
    ["amc", 24.9, null, null, null, ""],
    ["inbody_score", 74, null, null, null, ""],
    ["arm_r", 2.79, null, null, null, ""],
    ["arm_r_p", 88.7, null, null, null, ""],
    ["arm_l", 2.76, null, null, null, ""],
    ["arm_l_p", 87.9, null, null, null, ""],
    ["trunk", 23.4, null, null, null, ""],
    ["trunk_p", 93.3, null, null, null, ""],
    ["leg_r", 8.58, null, null, null, ""],
    ["leg_r_p", 98.1, null, null, null, ""],
    ["leg_l", 8.59, null, null, null, ""],
    ["leg_l_p", 98.2, null, null, null, ""],
    ["target_weight", 67.3, null, null, null, ""],
    ["adj_weight", 1.2, null, null, null, ""],
    ["adj_fat", -2.5, null, null, null, ""],
    ["adj_muscle", 3.7, null, null, null, ""]
  ]') v
   WHERE e.kind = 'inbody' AND e.exam_date = '2025-11-04'
     AND e.user_id = (SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1);

INSERT OR IGNORE INTO health_exams (user_id, exam_date, kind, provider, title, memo, created_at, updated_at)
  SELECT id, '2026-03-03', 'inbody', '삼성SDS (InBody 720)', '인바디 (InBody 75점)',
         '체중이 적정체중(67.4kg)에 닿았다. 다만 늘어난 쪽은 지방이다 — 지방조절 −2.3kg · 근육조절 +2.6kg.', datetime('now'), datetime('now')
    FROM users WHERE role = 'admin' ORDER BY id LIMIT 1;

INSERT OR IGNORE INTO health_results
  (user_id, exam_id, code, value_num, value_text, ref_low, ref_high, ref_text, created_at)
  SELECT e.user_id, e.id,
         json_extract(v.value, '$[0]'),
         json_extract(v.value, '$[1]'),
         COALESCE(json_extract(v.value, '$[2]'), ''),
         json_extract(v.value, '$[3]'),
         json_extract(v.value, '$[4]'),
         COALESCE(json_extract(v.value, '$[5]'), ''),
         datetime('now')
    FROM health_exams e,
         json_each('[
    ["height", 175, null, null, null, ""],
    ["weight", 67.1, null, 57.3, 77.5, "57.3~77.5"],
    ["bmi", 21.9, null, 18.5, 23.0, "18.5~23.0"],
    ["icw", 25.1, null, 23.5, 28.7, "23.5~28.7"],
    ["ecw_vol", 15.0, null, 14.4, 17.6, "14.4~17.6"],
    ["tbw", 40.1, null, null, null, ""],
    ["protein", 10.8, null, 10.2, 12.4, "10.2~12.4"],
    ["mineral_mass", 3.76, null, 3.5, 4.28, "3.50~4.28"],
    ["bmc", 3.13, null, 2.89, 3.53, "2.89~3.53"],
    ["fatmass", 12.4, null, 8.1, 16.2, "8.1~16.2"],
    ["slm", 51.6, null, null, null, ""],
    ["ffm", 54.7, null, null, null, ""],
    ["smm", 30.7, null, 28.8, 35.2, "28.8~35.2"],
    ["bodyfat", 18.5, null, 10.0, 20.0, "10.0~20.0"],
    ["fatdist", 0.84, null, 0.8, 0.9, "0.80~0.90"],
    ["vfa", 50.6, null, null, 100, "~100"],
    ["ecw", 0.375, null, 0.36, 0.39, "0.360~0.390"],
    ["ecf_tbf", 0.328, null, null, null, ""],
    ["obesity_deg", 99, null, 90, 110, "90~110"],
    ["bcm", 35.9, null, 33.6, 41.1, "33.6~41.1"],
    ["bmr", 1551, null, 1478, 1725, "1478~1725"],
    ["ac", 29.4, null, null, null, ""],
    ["amc", 24.9, null, null, null, ""],
    ["inbody_score", 75, null, null, null, ""],
    ["arm_r", 2.87, null, null, null, ""],
    ["arm_r_p", 89.8, null, null, null, ""],
    ["arm_l", 2.83, null, null, null, ""],
    ["arm_l_p", 88.5, null, null, null, ""],
    ["trunk", 23.7, null, null, null, ""],
    ["trunk_p", 92.9, null, null, null, ""],
    ["leg_r", 8.71, null, null, null, ""],
    ["leg_r_p", 98.2, null, null, null, ""],
    ["leg_l", 8.78, null, null, null, ""],
    ["leg_l_p", 98.9, null, null, null, ""],
    ["target_weight", 67.4, null, null, null, ""],
    ["adj_weight", 0.3, null, null, null, ""],
    ["adj_fat", -2.3, null, null, null, ""],
    ["adj_muscle", 2.6, null, null, null, ""]
  ]') v
   WHERE e.kind = 'inbody' AND e.exam_date = '2026-03-03'
     AND e.user_id = (SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1);

-- ── 2025-09-02 체성분 — ACCUNIQ X-SCAN Plus II (검진 때 같이 잰 것) ────
-- 기기가 달라 참고범위도 다르다. 행마다 그 용지의 범위를 적는다.
INSERT OR IGNORE INTO health_exams (user_id, exam_date, kind, provider, title, memo, created_at, updated_at)
  SELECT id, '2025-09-02', 'inbody', 'SCL 하나로리더스헬스케어 (ACCUNIQ X-SCAN)', '체성분 (ACCUNIQ X-SCAN)',
         'InBody 가 아니라 ACCUNIQ 로 잰 회차. 골격근은 기기마다 정의가 달라 코드를 따로 두었다(골격근(ACCUNIQ)). 근육량 −3.3kg 부족 판정 · 신체나이 49세.', datetime('now'), datetime('now')
    FROM users WHERE role = 'admin' ORDER BY id LIMIT 1;

INSERT OR IGNORE INTO health_results
  (user_id, exam_id, code, value_num, value_text, ref_low, ref_high, ref_text, created_at)
  SELECT e.user_id, e.id,
         json_extract(v.value, '$[0]'),
         json_extract(v.value, '$[1]'),
         COALESCE(json_extract(v.value, '$[2]'), ''),
         json_extract(v.value, '$[3]'),
         json_extract(v.value, '$[4]'),
         COALESCE(json_extract(v.value, '$[5]'), ''),
         datetime('now')
    FROM health_exams e,
         json_each('[
    ["height", 175.0, null, null, null, ""],
    ["weight", 64.5, null, 60.6, 74.1, "60.6~74.1"],
    ["bmi", 21.1, null, 18.5, 23.0, "18.5~23.0"],
    ["ffm", 52.1, null, 53.9, 57.2, "53.9~57.2"],
    ["slm", 48.3, null, 50.0, 53.2, "50.0~53.2"],
    ["smm_accuniq", 20.8, null, 21.7, 26.5, "21.7~26.5"],
    ["tbw", 37.5, null, 38.8, 41.2, "38.8~41.2"],
    ["icw", 22.8, null, 22.2, 24.4, "22.2~24.4"],
    ["ecw_vol", 14.7, null, 13.1, 15.3, "13.1~15.3"],
    ["protein", 10.8, null, 10.7, 12.1, "10.7~12.1"],
    ["mineral_mass", 3.8, null, 3.9, 4.0, "3.9~4.0"],
    ["fatmass", 12.4, null, 10.1, 13.5, "10.1~13.5"],
    ["bodyfat", 19.2, null, 10.0, 20.0, "10.0~20.0"],
    ["bmr", 1318, null, null, null, ""],
    ["daily_kcal", 2030, null, null, null, ""],
    ["body_age", 49, null, null, null, ""],
    ["ecw", 0.392, null, 0.36, 0.39, "0.360~0.390"],
    ["vfl", 11, null, null, 10, "~10"],
    ["vfat_kg", 1.7, null, null, null, ""],
    ["subfat_kg", 10.7, null, null, null, ""],
    ["arm_r", 3.37, null, null, null, ""],
    ["arm_r_p", 103, null, null, null, ""],
    ["arm_l", 3.38, null, null, null, ""],
    ["arm_l_p", 102, null, null, null, ""],
    ["trunk", 24.32, null, null, null, ""],
    ["trunk_p", 98, null, null, null, ""],
    ["leg_r", 8.58, null, null, null, ""],
    ["leg_r_p", 95, null, null, null, ""],
    ["leg_l", 8.67, null, null, null, ""],
    ["leg_l_p", 96, null, null, null, ""],
    ["target_weight", 67.4, null, null, null, ""],
    ["adj_weight", -2.9, null, null, null, ""],
    ["adj_fat", 0.6, null, null, null, ""],
    ["adj_muscle", -3.3, null, null, null, ""]
  ]') v
   WHERE e.kind = 'inbody' AND e.exam_date = '2025-09-02'
     AND e.user_id = (SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1);
