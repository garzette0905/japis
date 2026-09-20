-- 010 — 헬스정보 (건강검진 · 인바디 · 혈액검사)
--
--   npx wrangler d1 execute japis-db --remote --file=./migrations/010_health.sql
--
-- ── 왜 표를 셋으로 나누는가 ────────────────────────────────────────────
--
-- 검진 결과지를 그대로 옮겨 적으면 표 하나로 끝난다. 그런데 그렇게 담으면
-- **연도별로 비교할 수가 없다.** 2015년 결과지에 'SGPT'라고 적힌 것과 2024년
-- 결과지의 'ALT(SGPT)'는 같은 검사인데, 글자가 달라 나란히 세울 수 없다.
-- 단위도 흔들린다(지단백(a)는 2022년 mg/dL, 2023년부터 nmol/L 이다).
--
-- 그래서 **항목의 이름표(health_metrics)를 값(health_results)에서 떼어 둔다.**
-- 값에는 code 만 적고, 이름·단위·참고범위·좋은 방향은 이름표가 갖는다.
-- 병원이 뭐라고 적었든 code 하나로 모이면 10년치가 한 줄로 이어진다.
-- 이 표가 이 기능의 본체다 — 사진을 모으는 일이 아니라, 비교할 수 있게
-- 만드는 일이 값을 만든다.
--
--   health_exams    검진·측정 한 번 = 한 줄 (날짜 · 기관 · 종류)
--   health_metrics  항목 이름표 = 검사 코드표 (사람마다 다르지 않으므로 user_id 가 없다)
--   health_results  실제 값 (exam_id × code)
--
-- ── 참고범위를 값에도 두는 이유 ────────────────────────────────────────
--
-- 참고범위는 병원마다, 해마다 바뀐다. 이름표에만 두면 2015년 값을 2026년
-- 기준으로 그린 그래프가 나온다. 그래서 health_results 에도 ref_low/ref_high
-- 를 둔다 — **비어 있으면** 이름표의 것을 쓰고, 적혀 있으면 그것이 이긴다
-- (그 해의 결과지가 실제로 적어 준 범위다).

-- ── 검진·측정 한 번 ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS health_exams (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  exam_date  TEXT    NOT NULL,                  -- 'YYYY-MM-DD'
  -- 'checkup' 연 1회 종합검진 · 'inbody' 체성분 측정 · 'blood' 수시 피검사
  -- 종합검진은 '헬스정보' 화면이, 나머지 둘은 '인바디·혈액' 화면이 본다.
  kind       TEXT    NOT NULL DEFAULT 'checkup',
  provider   TEXT    NOT NULL DEFAULT '',       -- 강북삼성병원 종합건진센터 …
  title      TEXT    NOT NULL DEFAULT '',
  memo       TEXT    NOT NULL DEFAULT '',
  created_at TEXT    NOT NULL,
  updated_at TEXT    NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_health_exams_one
  ON health_exams (user_id, kind, exam_date);
CREATE INDEX IF NOT EXISTS idx_health_exams_user
  ON health_exams (user_id, kind, exam_date DESC);

-- ── 항목 이름표(코드표) ───────────────────────────────────────────────
-- 사람마다 다르지 않다. 새 검사가 나오면 여기 한 줄을 더한다.
CREATE TABLE IF NOT EXISTS health_metrics (
  code       TEXT    PRIMARY KEY,               -- 한 번 정하면 바꾸지 않는다(값이 이 글자로 붙어 있다)
  name_ko    TEXT    NOT NULL,
  name_en    TEXT    NOT NULL DEFAULT '',
  unit       TEXT    NOT NULL DEFAULT '',
  category   TEXT    NOT NULL,                  -- 분류 키. 이름은 cloudflare/health.js 의 CATEGORIES
  sort_order INTEGER NOT NULL DEFAULT 0,        -- 분류 안에서의 차례(결과지에 적힌 순서 그대로)
  ref_low    REAL,                              -- 참고범위 아래. NULL = 아래가 없다
  ref_high   REAL,                              -- 참고범위 위.   NULL = 위가 없다
  ref_text   TEXT    NOT NULL DEFAULT '',       -- 숫자가 아닌 기준('~음성')
  -- 'low'  낮을수록 좋다 (콜레스테롤)
  -- 'high' 높을수록 좋다 (HDL · 사구체여과율)
  -- 'mid'  범위 안이 좋다 (나트륨 · 칼륨)
  -- 'none' 좋고 나쁨이 없다 (신장 · 실제연령)
  direction  TEXT    NOT NULL DEFAULT 'mid',
  value_type TEXT    NOT NULL DEFAULT 'num',    -- 'num' 숫자 · 'text' 글자(정상/음성/소견)
  -- '인바디·혈액' 화면이 골라 담을 때 쓰는 묶음. NULL 이면 그 화면에 권하지 않는다.
  lab_group  TEXT,
  memo       TEXT    NOT NULL DEFAULT ''        -- 이 검사가 무엇을 보는지 한 줄
);

CREATE INDEX IF NOT EXISTS idx_health_metrics_cat
  ON health_metrics (category, sort_order);

-- ── 값 ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS health_results (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,                  -- 권한 검사를 잊어도 새지 않게 WHERE 에 늘 붙인다
  exam_id    INTEGER NOT NULL,
  code       TEXT    NOT NULL,
  value_num  REAL,                              -- 숫자로 읽히는 값
  value_text TEXT    NOT NULL DEFAULT '',       -- '정상' · '음성(0.04)' · '미란성위염'
  unit       TEXT    NOT NULL DEFAULT '',       -- 그 해의 단위가 이름표와 다를 때만
  ref_low    REAL,                              -- 그 해 결과지가 적어 준 참고범위(있으면 이것이 이긴다)
  ref_high   REAL,
  ref_text   TEXT    NOT NULL DEFAULT '',
  note       TEXT    NOT NULL DEFAULT '',
  created_at TEXT    NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_health_results_one
  ON health_results (exam_id, code);
CREATE INDEX IF NOT EXISTS idx_health_results_trend
  ON health_results (user_id, code);

-- ══════════════════════════════════════════════════════════════════════
-- 항목 이름표 — 강북삼성병원 종합건진센터 결과지(2024)의 차례 그대로
-- ══════════════════════════════════════════════════════════════════════

INSERT OR REPLACE INTO health_metrics
  (code, name_ko, name_en, unit, category, sort_order, ref_low, ref_high, ref_text, direction, value_type, lab_group, memo)
VALUES
-- ── 신체계측 ──────────────────────────────────────────────────────────
('height',        '신장',            'Height',                    'cm',       'body',         10, NULL,  NULL,  '',        'none', 'num', 'inbody', ''),
('weight',        '체중',            'Weight',                    'kg',       'body',         20, NULL,  NULL,  '',        'none', 'num', 'inbody', ''),
('bmi',           '체질량지수',      'Body Mass Index',           'kg/m²',    'body',         30, 18.5,  24.9,  '~24.9',   'mid',  'num', 'inbody', '18.5~22.9 가 정상체중 범위'),
('waist',         '평균허리둘레',    'Mean waist circumference',  'cm',       'body',         40, NULL,  89.9,  '~89.9',   'low',  'num', 'inbody', '남성 90cm 이상이면 복부비만'),

-- ── 체성분(인바디) ────────────────────────────────────────────────────
('slm',           '근육량',          'Soft lean mass',            'kg',       'composition',  10, NULL,  NULL,  '',        'high', 'num', 'inbody', ''),
('smm',           '골격근량',        'Skeletal muscle mass',      'kg',       'composition',  20, NULL,  NULL,  '',        'high', 'num', 'inbody', '팔다리·몸통을 움직이는 근육'),
('fatmass',       '체지방량',        'Body fat mass',             'kg',       'composition',  30, NULL,  NULL,  '',        'low',  'num', 'inbody', ''),
('bodyfat',       '체지방률',        'Percent body fat',          '%',        'composition',  40, 10,    20,    '10~20',   'mid',  'num', 'inbody', ''),
('fatdist',       '복부지방률',      'Fat distribution',          '',         'composition',  50, 0.80,  0.90,  '0.80~0.90','low', 'num', 'inbody', '허리/엉덩이 둘레의 비'),
('ffm',           '제지방량',        'Fat free mass',             'kg',       'composition',  60, 51.4,  62.9,  '',        'high', 'num', 'inbody', '체중에서 지방을 뺀 것'),
('tbw',           '체수분',          'Total body water',          'L',        'composition',  70, 37.8,  46.2,  '',        'mid',  'num', 'inbody', ''),
('protein',       '단백질',          'Protein',                   'kg',       'composition',  80, 10.2,  12.4,  '',        'mid',  'num', 'inbody', ''),
('mineral_mass',  '무기질',          'Minerals',                  'kg',       'composition',  90, 3.50,  4.28,  '',        'mid',  'num', 'inbody', ''),
('vfa',           '내장지방단면적',  'Visceral fat area',         'cm²',      'composition', 100, NULL,  100,   '~100',    'low',  'num', 'inbody', '100 이상이면 내장지방형 비만'),
('ecw',           '세포외수분비',    'ECW ratio',                 '',         'composition', 110, 0.360, 0.390, '0.360~0.390','low','num','inbody', '높으면 붓기·염증을 의심한다'),
('bmr',           '기초대사량',      'BMR',                       'kcal',     'composition', 120, 1444,  1683,  '',        'high', 'num', 'inbody', '가만히 있어도 쓰는 열량'),
('inbody_score',  '인바디점수',      'InBody score',              '점',       'composition', 130, NULL,  NULL,  '',        'high', 'num', 'inbody', '체성분 종합점수(100점 만점)'),
('obesity_deg',   '비만도',          'Degree of obesity',         '%',        'composition', 140, 90,    110,   '90~110',  'mid',  'num', 'inbody', ''),

-- ── 혈압·심장 ─────────────────────────────────────────────────────────
('sbp',           '평균혈압(최고)',  'Mean systolic pressure',    'mmHg',     'bp',           10, NULL,  119,   '~119',    'low',  'num', 'blood', '수축기 혈압'),
('dbp',           '평균혈압(최저)',  'Mean diastolic pressure',   'mmHg',     'bp',           20, NULL,  79,    '~79',     'low',  'num', 'blood', '이완기 혈압'),
('hr',            '심박수',          'Heart rate',                '회/분',    'bp',           30, 60,    90,    '60~90',   'mid',  'num', 'blood', ''),
('ecg',           '심전도',          'Electrocardiogram',         '',         'bp',           40, NULL,  NULL,  '',        'none', 'text', NULL,   ''),
('echo',          '심장초음파',      'Echocardiography',          '',         'bp',           50, NULL,  NULL,  '',        'none', 'text', NULL,   ''),

-- ── 지질·심혈관 ───────────────────────────────────────────────────────
('tchol',         '총콜레스테롤',    'T-cholesterol',             'mg/dL',    'lipid',        10, NULL,  199,   '0~199',   'low',  'num', 'blood', '200~239 경계, 240 이상 높음'),
('ldl',           '저밀도 콜레스테롤','LDL-cholesterol',          'mg/dL',    'lipid',        20, NULL,  129,   '0~129',   'low',  'num', 'blood', '혈관에 쌓이는 나쁜 콜레스테롤'),
('ldl_calc',      '저밀도 콜레스테롤(간접)','LDL-cholesterol(calc)','mg/dL',  'lipid',        30, NULL,  129,   '~129',    'low',  'num', 'blood', ''),
('hdl',           '고밀도 콜레스테롤','HDL-cholesterol',          'mg/dL',    'lipid',        40, 60,    NULL,  '60~',     'high', 'num', 'blood', '동맥경화를 막는 좋은 콜레스테롤'),
('tg',            '중성지방',        'Triglyceride',              'mg/dL',    'lipid',        50, NULL,  149,   '~149',    'low',  'num', 'blood', ''),
('ldh',           '유산탈수소효소',  'LDH',                       'U/L',      'lipid',        60, NULL,  250,   '0~250',   'low',  'num', 'blood', ''),
('hscrp',         '고감도C반응성단백질','HS-CRP',                 'mg/dL',    'lipid',        70, NULL,  0.3,   '0~0.3',   'low',  'num', 'blood', '혈관 염증의 정도'),
('apoa1',         'APO 지단백 A1',   'Apolipoprotein A1',         'mg/dL',    'lipid',        80, 110,   188,   '110~188', 'high', 'num', 'blood', ''),
('apob',          'APO 지단백 B',    'Apolipoprotein B',          'mg/dL',    'lipid',        90, 66,    144,   '66~144',  'low',  'num', 'blood', ''),
('lpa_nmol',      '지단백(a)',       'Lipoprotein(a)',            'nmol/L',   'lipid',       100, NULL,  75,    '0~75',    'low',  'num', 'blood', '타고나는 값이라 잘 변하지 않는다'),
('lpa_mg',        '지단백(a)',       'Lipoprotein(a)',            'mg/dL',    'lipid',       110, NULL,  57.7,  '0~57.7',  'low',  'num', 'blood', '2022년까지 쓰던 단위'),
('homocysteine',  '호모시스테인',    'Homocysteine',              'umol/L',   'lipid',       120, NULL,  15,    '0~15',    'low',  'num', 'blood', ''),
('ntprobnp',      'NTproBNP',        'NTproBNP',                  'pg/mL',    'lipid',       130, NULL,  NULL,  '',        'low',  'num', 'blood', '심부전 지표'),
('pwv_r',         '맥파전파속도(우)','baPWV(Rt)',                 'cm/s',     'lipid',       140, NULL,  1445,  '0~1445',  'low',  'num', NULL,    '동맥이 굳은 정도'),
('pwv_l',         '맥파전파속도(좌)','baPWV(Lt)',                 'cm/s',     'lipid',       150, NULL,  1445,  '0~1445',  'low',  'num', NULL,    ''),
('abi_r',         '하지동맥협착(우)','Ankle brachial index(Rt)',  '',         'lipid',       160, 0.91,  1.4,   '0.91~1.4','mid',  'num', NULL,    '다리 동맥이 막혔는지'),
('abi_l',         '하지동맥협착(좌)','Ankle brachial index(Lt)',  '',         'lipid',       170, 0.91,  1.4,   '0.91~1.4','mid',  'num', NULL,    ''),
('carotid',       '경동맥초음파',    'Carotid artery USG',        '',         'lipid',       180, NULL,  NULL,  '',        'none', 'text', NULL,   ''),
('tcd',           '뇌혈류검사',      'TCD',                       '',         'lipid',       190, NULL,  NULL,  '',        'none', 'text', NULL,   ''),

-- ── 당뇨·내분비 ───────────────────────────────────────────────────────
('glucose',       '공복혈당',        'Glucose',                   'mg/dL',    'sugar',        10, 70,    99,    '70~99',   'mid',  'num', 'blood', '100~125 당뇨전단계, 126 이상 당뇨'),
('hba1c',         '당화혈색소',      'HbA1c',                     '%',        'sugar',        20, NULL,  5.6,   '0~5.6',   'low',  'num', 'blood', '3개월치 평균 혈당. 5.7~6.4 전단계'),
('insulin',       '공복시 인슐린',   'Insulin(FB)',               'uIU/mL',   'sugar',        30, 2.6,   24.9,  '2.6~24.9','mid',  'num', 'blood', ''),
('ft3',           '유리 갑상선호르몬 3','FreeT3',                 'pg/mL',    'sugar',        40, 2.0,   4.4,   '2.0~4.4', 'mid',  'num', 'blood', ''),
('ft4',           '유리 갑상선호르몬 4','FreeT4',                 'ng/dL',    'sugar',        50, 0.84,  1.74,  '0.84~1.74','mid', 'num', 'blood', ''),
('tsh',           '갑상선자극호르몬','TSH',                       'uIU/mL',   'sugar',        60, 0.27,  4.20,  '0.27~4.20','mid', 'num', 'blood', ''),
('metabolic',     '대사증후군',      'Metabolic syndrome',        '',         'sugar',        70, NULL,  NULL,  '',        'none', 'text', NULL,   ''),

-- ── 간기능·간염 ───────────────────────────────────────────────────────
('tp',            '총단백',          'Total protein',             'g/dL',     'liver',        10, 6.7,   8.1,   '6.7~8.1', 'mid',  'num', 'blood', ''),
('alb',           '알부민',          'Albumin',                   'g/dL',     'liver',        20, 4.1,   5.1,   '4.1~5.1', 'mid',  'num', 'blood', ''),
('glob',          '글로불린',        'Globulin',                  'g/dL',     'liver',        30, NULL,  NULL,  '',        'mid',  'num', 'blood', ''),
('ag',            '알부민/글로불린 비','A/G Ratio',                '',         'liver',        40, 1.2,   2.2,   '1.2~2.2', 'mid',  'num', 'blood', ''),
('ast',           '혈청지오티',      'AST(SGOT)',                 'U/L',      'liver',        50, NULL,  40,    '~40',     'low',  'num', 'blood', '간세포가 상하면 오른다'),
('alt',           '혈청지피티',      'ALT(SGPT)',                 'U/L',      'liver',        60, NULL,  35,    '~35',     'low',  'num', 'blood', '간에 더 특이한 효소'),
('alp',           '알카라인포스파타제','Alk-phosphatase',          'U/L',      'liver',        70, 36,    100,   '36~100',  'mid',  'num', 'blood', ''),
('ggtp',          '감마-지티피',     'γ-GTP',                     'U/L',      'liver',        80, NULL,  63,    '0~63',    'low',  'num', 'blood', '음주에 가장 먼저 반응한다'),
('tbil',          '총빌리루빈',      'T-Bilirubin',               'mg/dL',    'liver',        90, NULL,  1.9,   '0~1.9',   'low',  'num', 'blood', ''),
('dbil',          '직접빌리루빈',    'D-Bilirubin',               'mg/dL',    'liver',       100, NULL,  0.5,   '0~0.5',   'low',  'num', 'blood', ''),
('idbil',         '간접빌리루빈',    'ID-Bilirubin',              'mg/dL',    'liver',       110, NULL,  1.37,  '0~1.37',  'low',  'num', 'blood', ''),
('usg_abd',       '상복부초음파',    'Ultrasonography',           '',         'liver',       120, NULL,  NULL,  '',        'none', 'text', NULL,   '간·담낭·췌장·비장·신장'),
('hbsag',         'B형간염표면항원', 'HBsAg',                     '',         'liver',       130, NULL,  NULL,  '~음성',   'none', 'text', NULL,   '양성이면 B형간염 보유'),
('hbsab',         'B형간염표면항체', 'HBsAb',                     '',         'liver',       140, NULL,  NULL,  '음성~양성','none','text', NULL,   '양성이면 면역이 있다'),
('hbcab',         'B형간염체부항체', 'HBcAb',                     '',         'liver',       150, NULL,  NULL,  '음성~양성','none','text', NULL,   ''),
('hcvab',         'C형간염 항체',    'HCV Ab',                    '',         'liver',       160, NULL,  NULL,  '~음성',   'none', 'text', NULL,   ''),
('havab',         'A형간염 면역상태','HAV Ab',                    '',         'liver',       170, NULL,  NULL,  '음성~양성','none','text', NULL,   ''),

-- ── 신장·소변 ─────────────────────────────────────────────────────────
('bun',           '혈중요소질소',    'BUN',                       'mg/dL',    'kidney',       10, 8,     20,    '8~20',    'mid',  'num', 'blood', ''),
('creatinine',    '혈청 크레아티닌','Creatinine(Blood)',          'mg/dL',    'kidney',       20, 0.70,  1.20,  '0.70~1.20','mid', 'num', 'blood', '콩팥이 거르는 노폐물'),
('bc_ratio',      '요소질소/크레아티닌 비','B/C Ratio',           '',         'kidney',       30, 9.2,   26.2,  '9.2~26.2','mid',  'num', 'blood', ''),
('egfr',          '사구체여과율',    'estimated GFR',             'mL/min',   'kidney',       40, 60,    NULL,  '60~',     'high', 'num', 'blood', '콩팥이 거르는 힘'),
('egfr_ckdepi',   '사구체여과율(CKD-EPI)','eGFR(CKD-EPI)',        'mL/min',   'kidney',       50, 60,    NULL,  '60~',     'high', 'num', 'blood', ''),
('u_sg',          '소변 비중',       'Specific gravity',          '',         'kidney',       60, 1.005, 1.030, '1.005~1.030','mid','num', NULL,   ''),
('u_ph',          '소변 산도',       'pH',                        '',         'kidney',       70, 4.8,   7.5,   '4.8~7.5', 'mid',  'num', NULL,    ''),
('u_glucose',     '요중 포도당',     'Urine glucose',             '',         'kidney',       80, NULL,  NULL,  '~음성',   'none', 'text', NULL,   ''),
('u_ketone',      '요중 케톤',       'Ketone',                    '',         'kidney',       90, NULL,  NULL,  '~음성',   'none', 'text', NULL,   ''),
('u_protein',     '요단백',          'Protein(urine)',            '',         'kidney',      100, NULL,  NULL,  '~음성',   'none', 'text', NULL,   '콩팥이 단백질을 새는지'),
('u_bilirubin',   '요 빌리루빈',     'Bilirubin(urine)',          '',         'kidney',      110, NULL,  NULL,  '~음성',   'none', 'text', NULL,   ''),
('u_urobilinogen','유로빌리노겐',    'Urobilinogen',              '',         'kidney',      120, NULL,  NULL,  '~약양성', 'none', 'text', NULL,   ''),
('u_nitrite',     '아질산염',        'Nitrite',                   '',         'kidney',      130, NULL,  NULL,  '~음성',   'none', 'text', NULL,   ''),
('u_blood',       '요잠혈',          'Blood(urine)',              '',         'kidney',      140, NULL,  NULL,  '~음성',   'none', 'text', NULL,   ''),
('u_rbc',         '요중 적혈구',     'RBC(urine)',                'HPF',      'kidney',      150, NULL,  NULL,  '~0-3',    'none', 'text', NULL,   ''),
('u_wbc',         '요중 백혈구',     'WBC(urine)',                'HPF',      'kidney',      160, NULL,  NULL,  '~0-3',    'none', 'text', NULL,   ''),
('u_epi',         '상피세포',        'Epithelial cell',           'HPF',      'kidney',      170, NULL,  NULL,  '~0-3',    'none', 'text', NULL,   ''),
('u_leu',         '요백혈구',        'LEU',                       '',         'kidney',      180, NULL,  NULL,  '~음성',   'none', 'text', NULL,   ''),

-- ── 요산·전해질 ───────────────────────────────────────────────────────
('uric_acid',     '요산',            'Uric acid',                 'mg/dL',    'mineral',      10, 2.8,   8.2,   '2.8~8.2', 'mid',  'num', 'blood', '높으면 통풍'),
('calcium',       '칼슘',            'Calcium',                   'mg/dL',    'mineral',      20, 8.6,   10.2,  '8.6~10.2','mid',  'num', 'blood', ''),
('phosphorus',    '인',              'Phosphorus',                'mg/dL',    'mineral',      30, 2.8,   4.5,   '2.8~4.5', 'mid',  'num', 'blood', ''),
('sodium',        '나트륨',          'Sodium',                    'mmol/L',   'mineral',      40, 135,   145,   '135~145', 'mid',  'num', 'blood', ''),
('potassium',     '칼륨',            'Potassium',                 'mmol/L',   'mineral',      50, 3.5,   5.5,   '3.5~5.5', 'mid',  'num', 'blood', ''),
('magnesium',     '마그네슘',        'Magnesium',                 'mg/dL',    'mineral',      60, 1.6,   2.6,   '1.6~2.6', 'mid',  'num', 'blood', ''),

-- ── 혈액(전혈구) ──────────────────────────────────────────────────────
('rbc',           '적혈구',          'RBC',                       '10⁶/uL',   'blood',        10, 4.34,  5.70,  '4.34~5.70','mid', 'num', 'blood', ''),
('hb',            '혈색소',          'Hb',                        'g/dL',     'blood',        20, 13,    16.5,  '13~16.5', 'mid',  'num', 'blood', '낮으면 빈혈'),
('hct',           '헤마토크리트',    'Hct',                       '%',        'blood',        30, 34.3,  49.9,  '34.3~49.9','mid', 'num', 'blood', ''),
('rdw',           '적혈구변이계수',  'RDW',                       '%',        'blood',        40, 11.7,  15.2,  '11.7~15.2','mid', 'num', 'blood', ''),
('ferritin',      '페리틴',          'Ferritin',                  'ng/mL',    'blood',        50, 59,    691,   '59~691',  'mid',  'num', 'blood', '몸에 저장된 철'),
('iron',          '철',              'Iron(Fe)',                  'ug/dL',    'blood',        60, 64,    215,   '64~215',  'mid',  'num', 'blood', ''),
('tibc',          '총철결합능',      'TIBC',                      'ug/dL',    'blood',        70, 236,   380,   '236~380', 'mid',  'num', 'blood', ''),
('tsat',          '철결핍지표',      'Transferrin saturation',    '%',        'blood',        80, 15,    NULL,  '15~',     'high', 'num', 'blood', ''),
('mcv',           '평균적혈구용적',  'MCV',                       'fL',       'blood',        90, 80.0,  97.7,  '80.0~97.7','mid', 'num', 'blood', ''),
('mch',           '평균적혈구혈색소량','MCH',                     'pg',       'blood',       100, 25.6,  35.5,  '25.6~35.5','mid', 'num', 'blood', ''),
('mchc',          '평균적혈구혈색소농도','MCHC',                  'g/dL',     'blood',       110, 31.6,  35.8,  '31.6~35.8','mid', 'num', 'blood', ''),
('platelet',      '혈소판',          'Platelet',                  '10³/uL',   'blood',       120, 150,   362,   '150~362', 'mid',  'num', 'blood', '피를 굳게 하는 세포'),
('mpv',           '평균 혈소판 용적','MPV',                       'fL',       'blood',       130, 9.4,   12.6,  '9.4~12.6','mid',  'num', 'blood', ''),
('pdw',           '혈소판 분포도',   'PDW',                       'fL',       'blood',       140, 9.8,   16.1,  '9.8~16.1','mid',  'num', 'blood', ''),
('wbc',           '백혈구',          'WBC',                       '10³/uL',   'blood',       150, 3.7,   9.8,   '3.7~9.8', 'mid',  'num', 'blood', '염증·감염에 반응한다'),
('anc',           '절대호중구수',    'ANC',                       '10³/uL',   'blood',       160, 1.5,   NULL,  '1.5~',    'high', 'num', 'blood', ''),
('neutrophil',    '호중구',          'Neutrophil',                '%',        'blood',       170, 38.1,  71.5,  '38.1~71.5','mid', 'num', 'blood', ''),
('eosinophil',    '호산구',          'Eosinophil',                '%',        'blood',       180, 0.5,   8.6,   '0.5~8.6', 'mid',  'num', 'blood', '알레르기에 오른다'),
('basophil',      '호염구',          'Basophil',                  '%',        'blood',       190, 0.1,   1.1,   '0.1~1.1', 'mid',  'num', 'blood', ''),
('lymphocyte',    '림프구',          'Lymphocyte',                '%',        'blood',       200, 20.3,  50.8,  '20.3~50.8','mid', 'num', 'blood', ''),
('monocyte',      '단핵구',          'Monocyte',                  '%',        'blood',       210, 3.5,   9.9,   '3.5~9.9', 'mid',  'num', 'blood', ''),
('eos_count',     '호산구수',        'Eosinophil count',          '',         'blood',       220, NULL,  500,   '0~500',   'low',  'num', 'blood', ''),

-- ── 염증·면역 ─────────────────────────────────────────────────────────
('crp',           'C-반응성단백질',  'CRP',                       '',         'inflam',       10, NULL,  NULL,  '~음성',   'none', 'text', NULL,   ''),
('rpr',           '매독선별검사',    'RPR',                       '',         'inflam',       20, NULL,  NULL,  '~음성',   'none', 'text', NULL,   ''),
('rf',            '류마티스인자',    'Rheumatoid factor',         '',         'inflam',       30, NULL,  NULL,  '~음성',   'none', 'text', NULL,   ''),
('ana',           '항핵항체',        'ANA',                       '',         'inflam',       40, NULL,  NULL,  '~음성',   'none', 'text', NULL,   ''),
('anti_ro',       '항-Ro 항체',      'Anti-Ro/SSA Ab',            'EUs',      'inflam',       50, NULL,  NULL,  '~음성',   'none', 'text', NULL,   ''),
('anti_la',       '항-La 항체',      'Anti-La/SSB Ab',            'EUs',      'inflam',       60, NULL,  NULL,  '~음성',   'none', 'text', NULL,   ''),

-- ── 호르몬 ────────────────────────────────────────────────────────────
('testosterone',  '테스토스테론',    'Testosterone',              'nmol/L',   'hormone',      10, NULL,  NULL,  '',        'mid',  'num', 'blood', ''),
('fai',           '유리 안드로겐지표','Free Androgen Index',      '%',        'hormone',      20, NULL,  NULL,  '',        'mid',  'num', 'blood', ''),
('shbg',          '성호르몬 결합 글로불린','SH-BG',               'nmol/L',   'hormone',      30, NULL,  NULL,  '',        'mid',  'num', 'blood', ''),

-- ── 뼈·비타민D ────────────────────────────────────────────────────────
('bmd_lumbar',    '골밀도검사(요추)','Lumbar BMD',                '',         'bone',         10, NULL,  NULL,  '',        'none', 'text', NULL,   ''),
('bmd_femur',     '골밀도검사(대퇴)','Femur BMD',                 '',         'bone',         20, NULL,  NULL,  '',        'none', 'text', NULL,   ''),
('bmd_l1l4',      '요추 L1-L4 골밀도','Lumbar L1-L4 BMD',         'g/cm²',    'bone',         30, NULL,  NULL,  '',        'high', 'num', NULL,    ''),
('bmd_l1l4_t',    '요추 T-score',    'Lumbar T-score',            '',         'bone',         40, -1.0,  NULL,  '-1.0~',   'high', 'num', NULL,    '-2.5 아래면 골다공증'),
('bmd_femur_t',   '대퇴 T-score',    'Femur T-score',             '',         'bone',         50, -1.0,  NULL,  '-1.0~',   'high', 'num', NULL,    ''),
('bmd_femur_tot', '대퇴 Total 골밀도','Femur Total BMD',          'g/cm²',    'bone',         60, NULL,  NULL,  '',        'high', 'num', NULL,    ''),
('vitd',          '총 비타민D',      'Total vitamin D',           'ng/mL',    'bone',         70, 30.1,  100,   '30.1~100','high', 'num', 'blood', '30 이하면 부족, 10 미만이면 결핍'),

-- ── 호흡기 ────────────────────────────────────────────────────────────
('cxr',           '흉부 X-선',       'Chest x-ray',               '',         'lung',         10, NULL,  NULL,  '',        'none', 'text', NULL,   ''),
('fvc_l',         '노력성 폐활량',   'FVC(L)',                    'L',        'lung',         20, NULL,  NULL,  '',        'high', 'num', NULL,    ''),
('fvc_p',         '노력성 폐활량(%)','FVC(%)',                    '%',        'lung',         30, 80,    NULL,  '80~',     'high', 'num', NULL,    ''),
('fev1_l',        '1초간 노력성 폐활량','FEV1(L)',                'L',        'lung',         40, NULL,  NULL,  '',        'high', 'num', NULL,    ''),
('fev1_p',        '1초간 노력성 폐활량(%)','FEV1(%)',             '%',        'lung',         50, 80,    NULL,  '80~',     'high', 'num', NULL,    ''),
('fev1fvc',       '1초간호기량/폐활량비','FEV1/FVC',              '%',        'lung',         60, 70,    NULL,  '70~',     'high', 'num', NULL,    '70 미만이면 만성폐쇄성폐질환 의심'),
('pef',           '최고 호기 유속',  'PEF(L/S)',                  'L/S',      'lung',         70, NULL,  NULL,  '',        'high', 'num', NULL,    ''),
('cotinine',      '코티닌(소변)',    'Cotinine(urine)',           'ng/mL',    'lung',         80, NULL,  100,   '0~100',   'low',  'num', NULL,    '담배를 피웠는지'),

-- ── 암검사 ────────────────────────────────────────────────────────────
('egd',           '위내시경검사',    'Duodenoscopy',              '',         'cancer',       10, NULL,  NULL,  '',        'none', 'text', NULL,   ''),
('colono',        '대장내시경검사',  'Colonoscopy',               '',         'cancer',       20, NULL,  NULL,  '',        'none', 'text', NULL,   ''),
('occult',        '대변잠혈',        'Occult blood',              '',         'cancer',       30, NULL,  NULL,  '~음성',   'none', 'text', NULL,   ''),
('petct',         'PET-CT',          'PET-CT',                    '',         'cancer',       40, NULL,  NULL,  '',        'none', 'text', NULL,   ''),
('afp',           '알파 태아성 단백질','AFP',                     'ng/mL',    'cancer',       50, NULL,  7.0,   '0~7.0',   'low',  'num', 'blood', '간암 표지자'),
('cea',           '암태아성 항원',   'CEA',                       'ng/mL',    'cancer',       60, NULL,  4.7,   '0~4.7',   'low',  'num', 'blood', '대장암 표지자'),
('psa',           '전립선 특이항원', 'PSA',                       'ng/mL',    'cancer',       70, NULL,  2.99,  '0~2.99',  'low',  'num', 'blood', '전립선 표지자'),
('ca199',         '암항원 19-9',     'CA 19-9',                   'U/mL',     'cancer',       80, NULL,  26.6,  '0~26.6',  'low',  'num', 'blood', '췌장·담도 표지자'),
('nse',           '엔에스이',        'NSE',                       'ng/mL',    'cancer',       90, NULL,  16.3,  '0~16.3',  'low',  'num', 'blood', '폐암 표지자'),
('cyfra',         '싸이프라 21-1',   'Cyfra 21-1',                'ng/mL',    'cancer',      100, NULL,  3.3,   '0~3.3',   'low',  'num', 'blood', '폐암 표지자'),

-- ── 눈·귀·치아 ────────────────────────────────────────────────────────
('eye_l',         '시력(좌)',        'Eyesight(Lt)',              '',         'senses',       10, NULL,  NULL,  '',        'high', 'num', NULL,    ''),
('eye_r',         '시력(우)',        'Eyesight(Rt)',              '',         'senses',       20, NULL,  NULL,  '',        'high', 'num', NULL,    ''),
('iop_l',         '평균안압(좌)',    'Intraocular pressure(Lt)',  'mmHg',     'senses',       30, 10,    21,    '10~21',   'mid',  'num', NULL,    '높으면 녹내장을 의심한다'),
('iop_r',         '평균안압(우)',    'Intraocular pressure(Rt)',  'mmHg',     'senses',       40, 10,    21,    '10~21',   'mid',  'num', NULL,    ''),
('fundus',        '안저촬영',        'Fundus examination',        '',         'senses',       50, NULL,  NULL,  '정상~',   'none', 'text', NULL,   ''),
('hear_l500',     '청력좌(500Hz)',   'Hearing(Lt,500Hz)',         'dB',       'senses',       60, NULL,  30,    '0~30',    'low',  'num', NULL,    ''),
('hear_l1000',    '청력좌(1000Hz)',  'Hearing(Lt,1000Hz)',        'dB',       'senses',       70, NULL,  30,    '0~30',    'low',  'num', NULL,    ''),
('hear_l2000',    '청력좌(2000Hz)',  'Hearing(Lt,2000Hz)',        'dB',       'senses',       80, NULL,  30,    '0~30',    'low',  'num', NULL,    ''),
('hear_r500',     '청력우(500Hz)',   'Hearing(Rt,500Hz)',         'dB',       'senses',       90, NULL,  30,    '0~30',    'low',  'num', NULL,    ''),
('hear_r1000',    '청력우(1000Hz)',  'Hearing(Rt,1000Hz)',        'dB',       'senses',      100, NULL,  30,    '0~30',    'low',  'num', NULL,    ''),
('hear_r2000',    '청력우(2000Hz)',  'Hearing(Rt,2000Hz)',        'dB',       'senses',      110, NULL,  30,    '0~30',    'low',  'num', NULL,    ''),
('dental',        '치과진찰',        'Dental exam',               '',         'senses',      120, NULL,  NULL,  '',        'none', 'text', NULL,   ''),

-- ── 스트레스·건강나이 ─────────────────────────────────────────────────
('stress_res',    '스트레스 저항도', 'Stress resistance',         '',         'stress',       10, 90,    150,   '90~150',  'high', 'num', NULL,    ''),
('ans_activity',  '자율신경 활성도', 'Autonomic activity',        '',         'stress',       20, 90,    150,   '90~150',  'high', 'num', NULL,    ''),
('ans_balance',   '자율신경 균형도', 'Autonomic balance',         '',         'stress',       30, NULL,  50,    '0~50',    'low',  'num', NULL,    '0에 가까울수록 균형'),
('stress_index',  '스트레스 지수',   'Stress index',              '',         'stress',       40, NULL,  NULL,  '',        'low',  'num', NULL,    ''),
('fatigue',       '피로도',          'Fatigue index',             '',         'stress',       50, NULL,  NULL,  '',        'low',  'num', NULL,    ''),
('hrv_hr',        '평균 심박동수',   'Mean heart rate',           '회/분',    'stress',       60, 60,    90,    '60~90',   'mid',  'num', NULL,    ''),
('cardiac_stab',  '심장 안정도',     'Electro-cardiac stability', '',         'stress',       70, 90,    150,   '90~150',  'high', 'num', NULL,    ''),
('age_real',      '실제연령',        'Chronological age',         '세',       'stress',       80, NULL,  NULL,  '',        'none', 'num', NULL,    ''),
('age_health',    '건강연령',        'Health age',                '세',       'stress',       90, NULL,  NULL,  '',        'low',  'num', NULL,    '실제연령보다 낮으면 좋다'),
('age_target',    '목표건강연령',    'Achievable age',            '세',       'stress',      100, NULL,  NULL,  '',        'none', 'num', NULL,    ''),
('age_cvd',       '심뇌혈관 나이',   'Cardiovascular age',        '세',       'stress',      110, NULL,  NULL,  '',        'low',  'num', NULL,    ''),
('cvd_risk10',    '10년 심뇌혈관 위험','10-year CVD risk',        '%',        'stress',      120, NULL,  NULL,  '',        'low',  'num', NULL,    '앞으로 10년 안에 생길 확률');

-- ── 권한 ──────────────────────────────────────────────────────────────
-- Jaden wiki 를 쓰는 사람에게 두 화면을 함께 열어 준다(Play Lists 와 같은 이유).
-- 'healthcheck' 는 이미 카탈로그에 있던 '준비중' 화면이라 행이 있을 수 있다 —
-- 그 경우에도 allowed 를 1로 돌려 둔다.
INSERT OR IGNORE INTO user_services (user_id, service_key, allowed, reauth)
  SELECT user_id, 'healthcheck', 1, 0
    FROM user_services
   WHERE service_key = 'jadenwiki' AND allowed = 1;

INSERT OR IGNORE INTO user_services (user_id, service_key, allowed, reauth)
  SELECT user_id, 'bodylab', 1, 0
    FROM user_services
   WHERE service_key = 'jadenwiki' AND allowed = 1;

UPDATE user_services SET allowed = 1, reauth = 0
 WHERE service_key IN ('healthcheck', 'bodylab');
