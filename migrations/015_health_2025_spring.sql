-- 015 — 2025 인바디 5회 · 2025-04-08 혈액검사
--
--   npx wrangler d1 execute japis-db --remote --file=./migrations/015_health_2025_spring.sql
--
-- ── 무엇이 들어오나 ────────────────────────────────────────────────────
--
-- 종이로만 있던 결과지를 스캔해 옮겨 적는다. 인바디 다섯 장(2025-03-28 ·
-- 04-29 · 07-16 · 08-13 · 2026-07-03)과 혈액검사 한 건(2025-04-08, 두 장짜리).
--
-- ── 이 다섯 장이 메우는 자리 ───────────────────────────────────────────
--
-- 013 까지의 인바디는 2024-11 부터 이어지다 **2025 봄·여름이 통째로 비어**
-- 있었다(2025-02-28 다음이 06-04, 그 다음이 09-02). 03-28 · 04-29 · 07-16 ·
-- 08-13 이 그 구멍을 메운다. 2026-07-03 은 지금까지 중 **가장 최근** 측정이다.
--
-- 그래서 선 하나가 달라진다 — 체지방률이 2025 내내 16~18% 에 머물다
-- 2026-07-03 에 20.1% 로 올라선다(경도비만 첫 체크). 같은 날 골격근량은
-- 29.8kg 으로 이 기록 전체의 바닥이다. **지방이 는 게 아니라 근육이 준
-- 자리를 지방이 채웠다**는 것이 두 값을 나란히 놓아야 보인다.
--
-- ── 혈액검사 한 건 ─────────────────────────────────────────────────────
--
-- 2025-04-08, 삼성SDS 부속의원 → GC Labs. 같은 검사실의 2025-11-06 회차가
-- 012 에 있으므로 **참고범위를 행마다 적는 방식을 그대로 따른다** — 요산
-- 3.4 가 그 이유다. 강북삼성 기준(2.8~8.2)이면 넉넉한 정상인데 이 검사실
-- 기준(3.4~7.0)에서는 하한에 딱 걸친 값이다. 결과지가 적어 준 범위로 봐야
-- 화면의 판정과 종이의 판정이 어긋나지 않는다.

-- ══════════════════════════════════════════════════════════════════════
-- 2025-03-28 인바디 — 삼성SDS (InBody 720)
-- ══════════════════════════════════════════════════════════════════════

INSERT OR IGNORE INTO health_exams (user_id, exam_date, kind, provider, title, memo, created_at, updated_at)
  SELECT id, '2025-03-28', 'inbody', '삼성SDS (InBody 720)', '인바디 (InBody 720 · 신체발달 75점)',
         '체중 65.8kg · 체지방률 18.1%. 적정체중 67.4kg 까지 체중조절 +1.6kg · 지방조절 -1.8kg · 근육조절 +3.4kg.', datetime('now'), datetime('now')
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
    ["weight", 65.8, null, 57.3, 77.5, "57.3~77.5"],
    ["bmi", 21.5, null, 18.5, 23.0, "18.5~23.0"],
    ["icw", 24.9, null, 23.5, 28.7, "23.5~28.7"],
    ["ecw_vol", 14.5, null, 14.4, 17.6, "14.4~17.6"],
    ["tbw", 39.4, null, null, null, ""],
    ["protein", 10.8, null, 10.2, 12.4, "10.2~12.4"],
    ["mineral_mass", 3.75, null, 3.5, 4.28, "3.50~4.28"],
    ["bmc", 3.07, null, 2.89, 3.53, "2.89~3.53"],
    ["fatmass", 11.9, null, 8.1, 16.2, "8.1~16.2"],
    ["slm", 50.8, null, null, null, ""],
    ["ffm", 53.9, null, null, null, ""],
    ["smm", 30.5, null, 28.8, 35.2, "28.8~35.2"],
    ["bodyfat", 18.1, null, 10.0, 20.0, "10.0~20.0"],
    ["fatdist", 0.83, null, 0.8, 0.9, "0.80~0.90"],
    ["vfa", 43.8, null, null, 100, "~100"],
    ["ecw", 0.368, null, 0.36, 0.39, "0.360~0.390"],
    ["ecf_tbf", 0.322, null, null, null, ""],
    ["obesity_deg", 97, null, 90, 110, "90~110"],
    ["bcm", 35.7, null, 33.6, 41.1, "33.6~41.1"],
    ["bmr", 1533, null, 1457, 1698, "1457~1698"],
    ["ac", 29.0, null, null, null, ""],
    ["amc", 24.5, null, null, null, ""],
    ["inbody_score", 75, null, null, null, ""],
    ["arm_r", 2.74, null, null, null, ""],
    ["arm_r_p", 87.5, null, null, null, ""],
    ["arm_l", 2.7, null, null, null, ""],
    ["arm_l_p", 86.4, null, null, null, ""],
    ["trunk", 23.1, null, null, null, ""],
    ["trunk_p", 92.6, null, null, null, ""],
    ["leg_r", 8.76, null, null, null, ""],
    ["leg_r_p", 100.7, null, null, null, ""],
    ["leg_l", 8.69, null, null, null, ""],
    ["leg_l_p", 99.8, null, null, null, ""],
    ["target_weight", 67.4, null, null, null, ""],
    ["adj_weight", 1.6, null, null, null, ""],
    ["adj_fat", -1.8, null, null, null, ""],
    ["adj_muscle", 3.4, null, null, null, ""]
  ]') v
   WHERE e.kind = 'inbody' AND e.exam_date = '2025-03-28'
     AND e.user_id = (SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1);

-- ══════════════════════════════════════════════════════════════════════
-- 2025-04-29 인바디 — 삼성SDS (InBody 720)
-- ══════════════════════════════════════════════════════════════════════

INSERT OR IGNORE INTO health_exams (user_id, exam_date, kind, provider, title, memo, created_at, updated_at)
  SELECT id, '2025-04-29', 'inbody', '삼성SDS (InBody 720)', '인바디 (InBody 720 · 신체발달 76점)',
         '체지방량 10.7kg · 체지방률 16.5% 로 낮은 축이다. 골격근량 30.5kg 은 3월과 같다 — 지방만 1.2kg 빠졌다.', datetime('now'), datetime('now')
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
    ["weight", 64.8, null, 57.3, 77.5, "57.3~77.5"],
    ["bmi", 21.2, null, 18.5, 23.0, "18.5~23.0"],
    ["icw", 24.9, null, 23.5, 28.7, "23.5~28.7"],
    ["ecw_vol", 14.7, null, 14.4, 17.6, "14.4~17.6"],
    ["tbw", 39.6, null, null, null, ""],
    ["protein", 10.8, null, 10.2, 12.4, "10.2~12.4"],
    ["mineral_mass", 3.75, null, 3.5, 4.28, "3.50~4.28"],
    ["bmc", 3.07, null, 2.89, 3.53, "2.89~3.53"],
    ["fatmass", 10.7, null, 8.1, 16.2, "8.1~16.2"],
    ["slm", 51.0, null, null, null, ""],
    ["ffm", 54.1, null, null, null, ""],
    ["smm", 30.5, null, 28.8, 35.2, "28.8~35.2"],
    ["bodyfat", 16.5, null, 10.0, 20.0, "10.0~20.0"],
    ["fatdist", 0.83, null, 0.8, 0.9, "0.80~0.90"],
    ["vfa", 40.2, null, null, 100, "~100"],
    ["ecw", 0.37, null, 0.36, 0.39, "0.360~0.390"],
    ["ecf_tbf", 0.324, null, null, null, ""],
    ["obesity_deg", 96, null, 90, 110, "90~110"],
    ["bcm", 35.7, null, 33.6, 41.1, "33.6~41.1"],
    ["bmr", 1538, null, 1440, 1678, "1440~1678"],
    ["ac", 28.7, null, null, null, ""],
    ["amc", 24.7, null, null, null, ""],
    ["inbody_score", 76, null, null, null, ""],
    ["arm_r", 2.81, null, null, null, ""],
    ["arm_r_p", 91.1, null, null, null, ""],
    ["arm_l", 2.77, null, null, null, ""],
    ["arm_l_p", 89.8, null, null, null, ""],
    ["trunk", 23.4, null, null, null, ""],
    ["trunk_p", 95.1, null, null, null, ""],
    ["leg_r", 8.72, null, null, null, ""],
    ["leg_r_p", 101.7, null, null, null, ""],
    ["leg_l", 8.65, null, null, null, ""],
    ["leg_l_p", 100.9, null, null, null, ""],
    ["target_weight", 67.4, null, null, null, ""],
    ["adj_weight", 2.6, null, null, null, ""],
    ["adj_fat", -0.6, null, null, null, ""],
    ["adj_muscle", 3.2, null, null, null, ""]
  ]') v
   WHERE e.kind = 'inbody' AND e.exam_date = '2025-04-29'
     AND e.user_id = (SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1);

-- ══════════════════════════════════════════════════════════════════════
-- 2025-07-16 인바디 — 삼성SDS (InBody 720)
-- ══════════════════════════════════════════════════════════════════════

INSERT OR IGNORE INTO health_exams (user_id, exam_date, kind, provider, title, memo, created_at, updated_at)
  SELECT id, '2025-07-16', 'inbody', '삼성SDS (InBody 720)', '인바디 (InBody 720 · 신체발달 75점)',
         '체지방률 17.4% 로 4월보다 0.9%p 올랐다. 부위별 근육은 다리(101~102%)가 팔(88~90%)보다 높은 형태가 이어진다.', datetime('now'), datetime('now')
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
    ["weight", 64.9, null, 57.3, 77.5, "57.3~77.5"],
    ["bmi", 21.2, null, 18.5, 23.0, "18.5~23.0"],
    ["icw", 24.7, null, 23.5, 28.7, "23.5~28.7"],
    ["ecw_vol", 14.5, null, 14.4, 17.6, "14.4~17.6"],
    ["tbw", 39.2, null, null, null, ""],
    ["protein", 10.7, null, 10.2, 12.4, "10.2~12.4"],
    ["mineral_mass", 3.64, null, 3.5, 4.28, "3.50~4.28"],
    ["bmc", 3.02, null, 2.89, 3.53, "2.89~3.53"],
    ["fatmass", 11.3, null, 8.1, 16.2, "8.1~16.2"],
    ["slm", 50.6, null, null, null, ""],
    ["ffm", 53.6, null, null, null, ""],
    ["smm", 30.2, null, 28.8, 35.2, "28.8~35.2"],
    ["bodyfat", 17.4, null, 10.0, 20.0, "10.0~20.0"],
    ["fatdist", 0.83, null, 0.8, 0.9, "0.80~0.90"],
    ["vfa", 42.2, null, null, 100, "~100"],
    ["ecw", 0.37, null, 0.36, 0.39, "0.360~0.390"],
    ["ecf_tbf", 0.324, null, null, null, ""],
    ["obesity_deg", 96, null, 90, 110, "90~110"],
    ["bcm", 35.4, null, 33.6, 41.1, "33.6~41.1"],
    ["bmr", 1527, null, 1442, 1680, "1442~1680"],
    ["ac", 28.9, null, null, null, ""],
    ["amc", 24.7, null, null, null, ""],
    ["inbody_score", 75, null, null, null, ""],
    ["arm_r", 2.77, null, null, null, ""],
    ["arm_r_p", 89.8, null, null, null, ""],
    ["arm_l", 2.74, null, null, null, ""],
    ["arm_l_p", 88.6, null, null, null, ""],
    ["trunk", 23.2, null, null, null, ""],
    ["trunk_p", 94.4, null, null, null, ""],
    ["leg_r", 8.79, null, null, null, ""],
    ["leg_r_p", 102.4, null, null, null, ""],
    ["leg_l", 8.7, null, null, null, ""],
    ["leg_l_p", 101.4, null, null, null, ""],
    ["target_weight", 67.4, null, null, null, ""],
    ["adj_weight", 2.5, null, null, null, ""],
    ["adj_fat", -1.2, null, null, null, ""],
    ["adj_muscle", 3.7, null, null, null, ""]
  ]') v
   WHERE e.kind = 'inbody' AND e.exam_date = '2025-07-16'
     AND e.user_id = (SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1);

-- ══════════════════════════════════════════════════════════════════════
-- 2025-08-13 인바디 — 삼성SDS (InBody 720)
-- ══════════════════════════════════════════════════════════════════════

INSERT OR IGNORE INTO health_exams (user_id, exam_date, kind, provider, title, memo, created_at, updated_at)
  SELECT id, '2025-08-13', 'inbody', '삼성SDS (InBody 720)', '인바디 (InBody 720 · 신체발달 76점)',
         '체중 64.5kg · 체지방률 16.4% 로 2025년의 바닥. 내장지방 39.9cm² 도 이 기록에서 가장 낮다.', datetime('now'), datetime('now')
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
    ["weight", 64.5, null, 57.3, 77.5, "57.3~77.5"],
    ["bmi", 21.1, null, 18.5, 23.0, "18.5~23.0"],
    ["icw", 24.8, null, 23.5, 28.7, "23.5~28.7"],
    ["ecw_vol", 14.6, null, 14.4, 17.6, "14.4~17.6"],
    ["tbw", 39.5, null, null, null, ""],
    ["protein", 10.7, null, 10.2, 12.4, "10.2~12.4"],
    ["mineral_mass", 3.68, null, 3.5, 4.28, "3.50~4.28"],
    ["bmc", 3.03, null, 2.89, 3.53, "2.89~3.53"],
    ["fatmass", 10.6, null, 8.1, 16.2, "8.1~16.2"],
    ["slm", 50.9, null, null, null, ""],
    ["ffm", 53.9, null, null, null, ""],
    ["smm", 30.4, null, 28.8, 35.2, "28.8~35.2"],
    ["bodyfat", 16.4, null, 10.0, 20.0, "10.0~20.0"],
    ["fatdist", 0.82, null, 0.8, 0.9, "0.80~0.90"],
    ["vfa", 39.9, null, null, 100, "~100"],
    ["ecw", 0.371, null, 0.36, 0.39, "0.360~0.390"],
    ["ecf_tbf", 0.325, null, null, null, ""],
    ["obesity_deg", 95, null, 90, 110, "90~110"],
    ["bcm", 35.6, null, 33.6, 41.1, "33.6~41.1"],
    ["bmr", 1534, null, 1435, 1672, "1435~1672"],
    ["ac", 28.7, null, null, null, ""],
    ["amc", 24.8, null, null, null, ""],
    ["inbody_score", 76, null, null, null, ""],
    ["arm_r", 2.8, null, null, null, ""],
    ["arm_r_p", 91.4, null, null, null, ""],
    ["arm_l", 2.77, null, null, null, ""],
    ["arm_l_p", 90.2, null, null, null, ""],
    ["trunk", 23.4, null, null, null, ""],
    ["trunk_p", 95.4, null, null, null, ""],
    ["leg_r", 8.75, null, null, null, ""],
    ["leg_r_p", 102.5, null, null, null, ""],
    ["leg_l", 8.73, null, null, null, ""],
    ["leg_l_p", 102.4, null, null, null, ""],
    ["target_weight", 67.4, null, null, null, ""],
    ["adj_weight", 2.9, null, null, null, ""],
    ["adj_fat", -0.5, null, null, null, ""],
    ["adj_muscle", 3.4, null, null, null, ""]
  ]') v
   WHERE e.kind = 'inbody' AND e.exam_date = '2025-08-13'
     AND e.user_id = (SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1);

-- ══════════════════════════════════════════════════════════════════════
-- 2026-07-03 인바디 — 삼성SDS (InBody 720)
-- ══════════════════════════════════════════════════════════════════════

INSERT OR IGNORE INTO health_exams (user_id, exam_date, kind, provider, title, memo, created_at, updated_at)
  SELECT id, '2026-07-03', 'inbody', '삼성SDS (InBody 720)', '인바디 (InBody 720 · 신체발달 73점)',
         '체지방률 20.1% 로 처음 경도비만 칸에 표시됐고, 골격근량 29.8kg 은 이 기록 전체의 바닥이다. 내장지방 53.1cm² 도 가장 높다. 지방조절 -3.3kg · 근육조절 +4.2kg.', datetime('now'), datetime('now')
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
    ["weight", 66.5, null, 57.3, 77.5, "57.3~77.5"],
    ["bmi", 21.7, null, 18.5, 23.0, "18.5~23.0"],
    ["icw", 24.4, null, 23.5, 28.7, "23.5~28.7"],
    ["ecw_vol", 14.5, null, 14.4, 17.6, "14.4~17.6"],
    ["tbw", 38.9, null, null, null, ""],
    ["protein", 10.6, null, 10.2, 12.4, "10.2~12.4"],
    ["mineral_mass", 3.64, null, 3.5, 4.28, "3.50~4.28"],
    ["bmc", 3.0, null, 2.89, 3.53, "2.89~3.53"],
    ["fatmass", 13.4, null, 8.1, 16.2, "8.1~16.2"],
    ["slm", 50.1, null, null, null, ""],
    ["ffm", 53.1, null, null, null, ""],
    ["smm", 29.8, null, 28.8, 35.2, "28.8~35.2"],
    ["bodyfat", 20.1, null, 10.0, 20.0, "10.0~20.0"],
    ["fatdist", 0.85, null, 0.8, 0.9, "0.80~0.90"],
    ["vfa", 53.1, null, null, 100, "~100"],
    ["ecw", 0.373, null, 0.36, 0.39, "0.360~0.390"],
    ["ecf_tbf", 0.326, null, null, null, ""],
    ["obesity_deg", 98, null, 90, 110, "90~110"],
    ["bcm", 35.0, null, 33.6, 41.1, "33.6~41.1"],
    ["bmr", 1517, null, 1468, 1713, "1468~1713"],
    ["ac", 29.3, null, null, null, ""],
    ["amc", 24.7, null, null, null, ""],
    ["inbody_score", 73, null, null, null, ""],
    ["arm_r", 2.73, null, null, null, ""],
    ["arm_r_p", 86.3, null, null, null, ""],
    ["arm_l", 2.71, null, null, null, ""],
    ["arm_l_p", 85.7, null, null, null, ""],
    ["trunk", 23.1, null, null, null, ""],
    ["trunk_p", 91.4, null, null, null, ""],
    ["leg_r", 8.67, null, null, null, ""],
    ["leg_r_p", 98.5, null, null, null, ""],
    ["leg_l", 8.71, null, null, null, ""],
    ["leg_l_p", 99.0, null, null, null, ""],
    ["target_weight", 67.4, null, null, null, ""],
    ["adj_weight", 0.9, null, null, null, ""],
    ["adj_fat", -3.3, null, null, null, ""],
    ["adj_muscle", 4.2, null, null, null, ""]
  ]') v
   WHERE e.kind = 'inbody' AND e.exam_date = '2026-07-03'
     AND e.user_id = (SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1);

-- ══════════════════════════════════════════════════════════════════════
-- 2025-04-08 혈액검사 — 삼성SDS 부속의원 → GC Labs
-- ══════════════════════════════════════════════════════════════════════
--
-- ⚠️ 012 의 2025-11-06 회차와 같은 검사실이라 **참고범위를 행마다 적는다.**
--    요산 3.4 가 이 검사실 하한과 정확히 같은 값이다.

INSERT OR IGNORE INTO health_exams (user_id, exam_date, kind, provider, title, memo, created_at, updated_at)
  SELECT id, '2025-04-08', 'blood', '삼성SDS 부속의원 (GC Labs)', '혈액검사',
         '공복혈당 111 높음(H), 당화혈색소 6.2 로 당뇨고위험군. 총콜레스테롤 198·LDL 128 은 기준 안이나 최적(<100)보다 높다. 요산 3.4 는 이 검사실 하한과 같다.',
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
    ["ast",         25,   0,    40,   "0~40"],
    ["alt",         18,   0,    41,   "0~41"],
    ["ldh",         181,  135,  225,  "135~225"],
    ["alp",         48,   40,   129,  "40~129"],
    ["ck",          109,  null, 190,  "< 190"],
    ["ggtp",        35,   10,   71,   "10~71"],
    ["glucose",     111,  70,   99,   "70~99"],
    ["tbil",        0.6,  0.0,  1.2,  "0.0~1.2"],
    ["dbil",        0.2,  0.0,  0.3,  "0.0~0.3"],
    ["bun",         17,   6,    20,   "6~20"],
    ["creatinine",  1.13, 0.70, 1.20, "0.70~1.20"],
    ["uric_acid",   3.4,  3.4,  7.0,  "3.4~7.0"],
    ["hba1c",       6.2,  null, 5.6,  "≤ 5.6"],
    ["hba1c_ifcc",  44,   null, 38,   "≤ 38"],
    ["eag",         131,  null, null, ""],
    ["tchol",       198,  null, 199,  "< 200"],
    ["hdl",         52,   40,   null, "40~"],
    ["ldl",         128,  null, 129,  "< 130"],
    ["tg",          107,  null, 149,  "< 150"],
    ["egfr_mdrd",   68,   60,   null, "60~"]
  ]') v
   WHERE e.kind = 'blood' AND e.exam_date = '2025-04-08'
     AND e.user_id = (SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1);
