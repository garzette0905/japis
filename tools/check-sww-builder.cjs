// Run with Playwright available in NODE_PATH (or installed locally).
const { chromium } = require('playwright');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setContent(readFileSync(path.join(__dirname, '../web/public/sww-pro/prompt-builder.html'), 'utf8'));
    const check = c => page.locator(`input[name="docType"][value="${c}"]`);
    const output = async () => {
      const prompt = await page.locator('#prompt').inputValue();
      return { prompt, json: JSON.parse(prompt.match(/```json\s*([\s\S]*?)```/)[1]) };
    };
    assert.equal(await page.locator('#audience').inputValue(), 'working');
    assert.match((await output()).prompt, /garzette.kim@samsung.com/);
    assert.equal(await page.locator('input[name="docType"]').count(), 11);
    assert.equal(await check('09').isEnabled(), true);
    assert.equal(await check('10').isDisabled(), true);
    assert.equal(await check('11').isDisabled(), true);
    await check('09').check();
    let r = await output();
    assert.equal(r.json.document_type.primary.code, '01');
    assert.equal(r.json.document_type.additional[0].code, '09');
    assert.equal(r.json.infographic_summary.appendix_number, 1);
    const referencePaths = [
      'assets/infographic/gadget-business.png',
      'assets/infographic/gadget-casual.png',
      'assets/infographic/gadget-work-reactions.png',
    ];
    assert.deepEqual(r.json.infographic_summary.character_reference_paths, referencePaths);
    assert.match(r.json.infographic_summary.character_appearance_policy, /얼굴.*안경.*시계.*SDS 사원증.*만능팔.*복장.*도구.*흰 장갑/);
    assert.match(r.json.infographic_summary.title_policy, /타이틀 바로 아래 한 줄 부제목/);
    assert.match(r.prompt, /하위 상세.*2~3개/);
    assert.equal(r.json.infographic_summary.character, 'SDS IT 기획자 형사 가제트');
    assert.match(r.json.infographic_summary.character_personality, /허당.*따뜻/);
    assert.match(r.json.infographic_summary.explanation_audience, /직장 상사.*친구.*동료.*후배.*아이들/);
    assert.match(r.json.infographic_summary.gadget_policy, /장면마다.*기기 하나/);
    assert.match(r.json.infographic_summary.visual_style, /단순한 만화/);
    assert.equal(r.json.infographic_summary.reference_policy, 'bundled_png');
    assert.match(r.prompt, /references\/infographic.md/);
    assert.match(r.prompt, /형사 가제트/);
    for (const file of referencePaths) assert.ok(r.prompt.includes(file));
    assert.ok(r.prompt.includes(r.json.infographic_summary.character_appearance_policy));
    assert.ok(r.prompt.includes(r.json.infographic_summary.explanation_audience));
    assert.match(r.prompt, /기기는 만화적 비유/);
    await check('01').uncheck();
    r = await output();
    assert.equal(r.json.document_type.primary.code, '09');
    assert.equal(r.json.document_type.primary.mode, 'infographic');
    assert.equal(r.json.document_type.primary.standalone, true);
    assert.equal(r.json.apply_audience_depth, false);
    await page.locator('#toggleAdvanced').click();
    await page.locator('#toc').selectOption('yes');
    await page.locator('#includeDiagram').check();
    r = await output();
    assert.equal(r.json.toc, false);
    assert.ok(!r.json.include_diagrams);
    await page.locator('#toc').selectOption('no');
    await page.locator('#includeDiagram').uncheck();
    await check('07').check();
    await check('08').check();
    r = await output();
    assert.equal(r.json.document_type.primary.code, '07');
    assert.deepEqual(r.json.document_type.additional.map(x => x.code), ['08', '09']);
    await check('07').uncheck();
    await check('08').uncheck();
    await check('09').uncheck();
    assert.equal(await check('01').isChecked(), true);
    for (const primary of ['02', '03', '04', '05', '06']) {
      await check(primary).check();
      await check('09').check();
      r = await output();
      assert.equal(r.json.document_type.primary.code, primary);
      assert.equal(r.json.infographic_summary.pages, 1);
      await check('09').uncheck();
    }
    await check('03').check();
    await page.locator('#ceoWeekly').check();
    await check('09').check();
    r = await output();
    assert.equal(r.json.ceo_weekly_report.enabled, true);
    assert.match(r.prompt, /infographicAppendix/);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await check('09').isVisible(), true);
    await page.screenshot({ path: path.join(__dirname, '../qa_render/infographic-builder-mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: path.join(__dirname, '../qa_render/infographic-builder-desktop.png'), fullPage: true });
    await page.setContent(readFileSync(path.join(__dirname, '../web/public/sww-pro/user-manual.html'), 'utf8'));
    assert.match(await page.locator('body').innerText(), /11가지 문서 유형/);
    assert.match(await page.locator('body').innerText(), /09_\(별첨\) 1페이지 인포그래픽/);
    assert.match(await page.locator('body').innerText(), /캐릭터 외형.*SDS 사원증/);
    assert.match(await page.locator('body').innerText(), /직장 상사.*친구.*동료.*후배.*아이들/);
    assert.deepEqual(errors, []);
    console.log('[infographic-builder] PASS: 11 options; standalone, mixed, all primary types, CEO weekly, mobile; no JS errors');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
