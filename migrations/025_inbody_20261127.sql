-- 2026-11-27 InBody 720, 삼성SDS. 재실행해도 기존 결과를 덮어쓰지 않는다.
INSERT OR IGNORE INTO health_exams (user_id, exam_date, kind, provider, title, memo, created_at, updated_at)
SELECT id, '2026-11-27', 'inbody', '삼성SDS', '2026-11-27 인바디 (InBody 720 · 신체발달 72점)',
       '측정 06:50:49. 부위별 ECF/TBF: 오른팔 0.328, 왼팔 0.327, 몸통 0.326, 오른다리 0.328, 왼다리 0.325.', datetime('now'), datetime('now')
FROM users WHERE lower(email) = 'garzette@paran.com' LIMIT 1;

INSERT OR IGNORE INTO health_results (user_id, exam_id, code, value_num, value_text, ref_low, ref_high, ref_text, created_at)
SELECT e.user_id, e.id, json_extract(v.value, '$[0]'), json_extract(v.value, '$[1]'),
       COALESCE(json_extract(v.value, '$[5]'), ''), json_extract(v.value, '$[2]'),
       json_extract(v.value, '$[3]'), COALESCE(json_extract(v.value, '$[4]'), ''), datetime('now')
FROM health_exams e, json_each('[
 ["height",175,null,null,""], ["weight",66.3,57.3,77.5,"57.3~77.5"],
 ["bmi",21.6,18.5,23.0,"18.5~23.0"], ["icw",24.3,23.5,28.7,"23.5~28.7"],
 ["ecw_vol",14.4,14.4,17.6,"14.4~17.6"], ["tbw",38.7,null,null,""],
 ["protein",10.5,10.2,12.4,"10.2~12.4"], ["mineral_mass",3.53,3.50,4.28,"3.50~4.28"],
 ["bmc",2.97,2.89,3.53,"2.89~3.53"], ["fatmass",13.5,8.1,16.2,"8.1~16.2"],
 ["slm",49.9,null,null,""], ["ffm",52.8,null,null,""], ["smm",29.7,28.8,35.2,"28.8~35.2"],
 ["bodyfat",20.3,10,20,"10.0~20.0"], ["fatdist",0.85,0.80,0.90,"0.80~0.90"],
 ["vfa",53.4,null,100,"~100"], ["ecw",0.373,null,null,""], ["ecf_tbf",0.326,null,null,""],
 ["obesity_deg",98,90,110,"90~110"], ["bcm",34.8,33.6,41.1,"33.6~41.1"],
 ["bmr",1510,1465,1708,"1465~1708"], ["ac",29.2,null,null,""], ["amc",24.8,null,null,""],
 ["inbody_score",72,null,null,""], ["arm_r",2.72,null,null,""], ["arm_r_p",86.2,null,null,""],
 ["arm_l",2.71,null,null,""], ["arm_l_p",85.8,null,null,""], ["trunk",23.0,null,null,""],
 ["trunk_p",91.5,null,null,""], ["leg_r",8.66,null,null,""], ["leg_r_p",98.8,null,null,""],
 ["leg_l",8.75,null,null,""], ["leg_l_p",99.8,null,null,""],
 ["ecw_arm_r",0.374,null,null,""], ["ecw_arm_l",0.374,null,null,""],
 ["ecw_trunk",0.373,null,null,""], ["ecw_leg_r",0.374,null,null,""], ["ecw_leg_l",0.372,null,null,""],
 ["target_weight",67.3,null,null,""], ["adj_weight",1.0,null,null,""],
 ["adj_fat",-3.4,null,null,""], ["adj_muscle",4.4,null,null,""],
 ["inbody_impedance",null,null,null,"","단위 Ω; 순서 RA/LA/TR/RL/LL. 1kHz:385.9/387.4/31.9/300.5/295.8; 5kHz:376.5/378.4/30.8/295.4/291.1; 50kHz:335.1/337.9/26.7/258.0/251.8; 250kHz:302.4/304.4/23.1/230.8/223.8; 500kHz:291.0/293.1/21.7/223.7/216.7; 1000kHz:280.8/283.2/20.3/217.8/210.6."]
]') v
WHERE e.user_id = (SELECT id FROM users WHERE lower(email) = 'garzette@paran.com' LIMIT 1)
  AND e.kind = 'inbody' AND e.exam_date = '2026-11-27';
