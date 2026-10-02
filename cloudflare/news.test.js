import test from 'node:test';
import assert from 'node:assert/strict';
import { decode, stripHtml, parseDate, parseFeed, parseHn, safeUrl, isAi, cluster, rank, translate, buildNews, newsFeed, SOURCES } from './news.js';
import { topCard, latestCard, safeNewsUrl } from '../web/public/news.js';
import worker from './index.js';

const now = Date.parse('2026-10-03T03:00:00Z');
const src = (id) => SOURCES.find((s) => s.id === id);
const item = (over = {}) => ({ source: 'techcrunch', publisher: 'TechCrunch', publisherUrl: '', title: 'OpenAI launches new reasoning model for developers', url: 'https://techcrunch.com/a',
  summary: '', at: now - 3600000, lang: 'en', position: 0, paywall: false, ...over });
function kv() {
  const values = new Map();
  return { values, async get(k, type) { const v = values.get(k); return type === 'json' ? JSON.parse(v || 'null') : v ?? null; }, async put(k, v) { values.set(k, v); }, async delete(k) { values.delete(k); } };
}

test('RSS 문자열의 CDATA·엔티티·HTML을 걷어낸다', () => {
  assert.equal(decode('<![CDATA[A &amp; B]]>'), 'A & B');
  assert.equal(decode('Don&#8217;t &#x41;'), 'Don’t A');
  assert.equal(stripHtml('&lt;p&gt;Hello <b>world</b>&lt;/p&gt;'), 'Hello world');
});

test('시간대 없는 AI타임스 날짜는 서울 시각으로 읽는다', () => {
  assert.equal(parseDate('2026-10-03 07:00:00'), Date.parse('2026-10-02T22:00:00Z'));
  assert.equal(parseDate('Fri, 02 Oct 2026 21:09:14 +0000'), Date.parse('2026-10-02T21:09:14Z'));
  assert.equal(parseDate('nope'), null);
});

test('RSS · Atom · Google 뉴스 항목을 같은 모양으로 읽는다', () => {
  const rss = `<rss><channel><item><title>AI 기사 &quot;하나&quot;</title><link>https://www.aitimes.com/news/articleView.html?idxno=1</link>
    <description><![CDATA[<p>요약입니다</p>]]></description><pubDate>2026-10-03 07:00:00</pubDate></item>
    <item><title>링크 없음</title><pubDate>2026-10-03 07:00:00</pubDate></item>
    <item><title>나쁜 링크</title><link>javascript:alert(1)</link><pubDate>2026-10-03 07:00:00</pubDate></item></channel></rss>`;
  const a = parseFeed(rss, src('aitimes'));
  assert.equal(a.length, 1);
  assert.equal(a[0].title, 'AI 기사 "하나"'); assert.equal(a[0].summary, '요약입니다'); assert.equal(a[0].lang, 'ko');

  const atom = `<feed><entry><published>2026-10-02T19:00:48Z</published><link rel="alternate" type="text/html" href="https://www.theinformation.com/articles/x"/>
    <title>OpenAI Hires Official</title><content type="html">&lt;p&gt;Teaser text.&lt;/p&gt;</content></entry></feed>`;
  const b = parseFeed(atom, src('theinformation'));
  assert.equal(b[0].url, 'https://www.theinformation.com/articles/x'); assert.equal(b[0].summary, 'Teaser text.'); assert.equal(b[0].paywall, true);

  const google = `<rss><channel><item><title>Big AI deal - Reuters</title><link>https://news.google.com/rss/articles/abc?oc=5</link>
    <pubDate>Fri, 02 Oct 2026 20:46:00 GMT</pubDate><description>&lt;a href="x"&gt;Big AI deal&lt;/a&gt;</description><source url="https://www.reuters.com">Reuters</source></item>
    <item><title>Second - WSJ</title><link>https://news.google.com/rss/articles/def</link><pubDate>Fri, 02 Oct 2026 20:46:00 GMT</pubDate><source url="https://www.wsj.com">WSJ</source></item></channel></rss>`;
  const c = parseFeed(google, src('gnews-en'));
  assert.deepEqual(c.map((i) => [i.title, i.publisher, i.position]), [['Big AI deal', 'Reuters', 0], ['Second', 'WSJ', 1]]);
  assert.equal(c[0].summary, '');
});

test('Hacker News는 점수가 낮은 글을 빼고 원문 주소를 대표로 쓴다', () => {
  const hits = parseHn({ hits: [
    { objectID: '1', title: 'Claude ships agents', url: 'https://www.anthropic.com/news/x', points: 120, num_comments: 40, created_at: '2026-10-03T01:00:00Z' },
    { objectID: '2', title: 'Ask HN: AI?', points: 30, created_at: '2026-10-03T01:00:00Z' },
    { objectID: '3', title: 'tiny', url: 'https://a.example', points: 3, created_at: '2026-10-03T01:00:00Z' },
  ] });
  assert.equal(hits.length, 2);
  assert.equal(hits[0].publisher, 'anthropic.com'); assert.equal(hits[0].hn.points, 120);
  assert.equal(hits[1].url, 'https://news.ycombinator.com/item?id=2');
});

test('AI 판정과 링크 검사', () => {
  assert.ok(isAi('Nvidia unveils new GPU')); assert.ok(isAi('오픈AI, 새 모델 공개')); assert.ok(!isAi('Crypto custodian lays off staff'));
  assert.ok(!isAi('Said the chairman')); // 부분 단어 'ai' 는 AI 가 아니다
  assert.equal(safeUrl('javascript:alert(1)'), ''); assert.equal(safeNewsUrl('data:text/html,1'), '');
});

test('같은 이야기를 다룬 기사들을 하나로 묶는다', () => {
  const groups = cluster([
    item(),
    item({ source: 'verge', publisher: 'The Verge', url: 'https://theverge.com/b', title: 'OpenAI launches a new reasoning model' }),
    item({ source: 'gnews-en', publisher: 'Reuters', url: 'https://news.google.com/c', title: 'OpenAI launches reasoning model for developers, says CEO' }),
    item({ url: 'https://techcrunch.com/d', title: 'Apple tightens macOS disk access controls' }),
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].items.length, 3);
});

test('여러 매체가 다룬 이야기가 위로 오고, 관련 보도는 매체당 하나이며, 순위 변동을 표시한다', () => {
  const items = [
    item({ source: 'aitimes', publisher: 'AI타임스', url: 'https://aitimes.com/solo', title: '국내 스타트업 AI 반도체 시제품', lang: 'ko' }),
    item(),
    item({ source: 'verge', publisher: 'The Verge', url: 'https://theverge.com/b', title: 'OpenAI launches a new reasoning model' }),
    item({ source: 'gnews-en', publisher: 'TechCrunch', url: 'https://news.google.com/tc', title: 'OpenAI launches new reasoning model for developers' }),
    item({ source: 'gnews-en', publisher: 'Reuters', url: 'https://news.google.com/r', title: 'OpenAI launches reasoning model for developers' }),
    item({ url: 'https://techcrunch.com/old', title: 'Old AI story nobody covers', at: now - 40 * 3600000 }),
  ];
  const top = rank(items, now, { top: [{ url: 'https://aitimes.com/solo', related: [] }] });
  assert.equal(top[0].url, 'https://techcrunch.com/a');
  assert.equal(top[0].coverage, 3);
  assert.deepEqual(top[0].related.map((r) => r.publisher).sort(), ['Reuters', 'The Verge']);
  assert.equal(top[0].previousRank, null);
  assert.equal(top[1].previousRank, 1);
  assert.equal(top[1].titleKo, '국내 스타트업 AI 반도체 시제품');
  assert.ok(!top.some((t) => t.url.endsWith('/old')), '36시간이 지난 기사는 뺀다');
});

test('대표 기사는 사용자가 자주 보는 매체를 먼저 고르고, 한 매체는 4건까지만 오른다', () => {
  const lead = rank([
    item({ source: 'gnews-en', publisher: 'Bloomberg', url: 'https://news.google.com/x', title: 'Nvidia raises guidance on AI demand', position: 0 }),
    item({ source: 'theinformation', publisher: 'The Information', url: 'https://theinformation.com/x', title: 'Nvidia raises guidance on AI chip demand', paywall: true }),
  ], now);
  assert.equal(lead[0].publisher, 'The Information'); assert.equal(lead[0].paywall, true);
  const titles = ['Robot vacuum learns stairs', 'Chip startup files patent', 'Model card standards debated', 'Seed round closes quietly',
    'Court weighs copyright claim', 'Cloud region opens Seoul', 'Agent benchmark released today', 'Voice cloning detector tested'];
  const many = titles.map((title, i) => item({ url: `https://techcrunch.com/${i}`, title }));
  assert.equal(rank(many, now).length, 4);
});

test('영어 기사 번역은 AI 답만 덧붙이고, 실패하면 원문을 그대로 둔다', async () => {
  const top = [{ title: 'A', summary: 's', lang: 'en', titleKo: null, summaryKo: null }, { title: '가', lang: 'ko', titleKo: '가' }];
  let prompt;
  await translate({ AI: { async run(_, opts) { prompt = opts.messages[1].content; return { response: '```json\n{"items":[{"i":0,"title_ko":"에이","summary_ko":"요약"},{"i":9,"title_ko":"x"}]}\n```' }; } } }, top);
  assert.equal(top[0].titleKo, '에이'); assert.equal(top[0].summaryKo, '요약');
  assert.equal(JSON.parse(prompt).length, 1, '한국어 기사는 번역하지 않는다');
  const failing = [{ title: 'B', lang: 'en', titleKo: null }];
  await translate({ AI: { async run() { throw new Error('quota'); } } }, failing);
  assert.equal(failing[0].titleKo, null);
});

test('스냅숏: 일부 매체가 실패해도 만들고, 오래되거나 없을 때만 다시 모으며 수동 갱신은 10분 간격', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url) => {
    calls++;
    const u = String(url);
    if (u.includes('techcrunch')) return new Response(`<rss><item><title>OpenAI launches model</title><link>https://techcrunch.com/a</link><pubDate>${new Date(now - 60000).toUTCString()}</pubDate></item></rss>`);
    if (u.includes('theinformation')) return new Response(`<feed><entry><title>Crypto layoffs</title><link href="https://theinformation.com/c"/><published>${new Date(now).toISOString()}</published></entry></feed>`);
    if (u.includes('algolia')) return Response.json({ hits: [] });
    return new Response('nope', { status: 503 });
  });
  const env = { SESSIONS: kv() };
  const first = await newsFeed(env, { now });
  assert.equal(first.top.length, 1); assert.equal(first.top[0].publisher, 'TechCrunch');
  assert.equal(first.latest.length, 1, 'AI와 무관한 The Information 글은 뺀다');
  assert.equal(first.sources.find((s) => s.id === 'verge').ok, false);
  assert.equal(first.sources.find((s) => s.id === 'verge').error, '수집 실패');
  const after = calls;
  await newsFeed(env, { now: now + 5 * 60000, refresh: true });
  assert.equal(calls, after, '10분 안의 수동 갱신은 저장본을 준다');
  await newsFeed(env, { now: now + 11 * 60000, refresh: true });
  assert.ok(calls > after);
  const waits = [];
  const stale = await newsFeed(env, { now: now + 3 * 3600000, ctx: { waitUntil: (p) => waits.push(p) } });
  assert.ok(stale.builtAt); assert.equal(waits.length, 1, '오래된 저장본은 바로 주고 뒤에서 갱신한다');
  await Promise.all(waits);
});

test('모든 매체가 실패하면 빈 순위를 저장하지 않는다', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('x', { status: 500 }));
  const env = { SESSIONS: kv() };
  const snap = await buildNews(env, now);
  assert.equal(snap.top.length, 0); assert.equal(env.SESSIONS.values.size, 0);
});

test('카드 HTML은 이스케이프하고 스크립트 링크를 만들지 않는다', () => {
  const html = topCard({ rank: 1, previousRank: null, title: '<img src=x onerror=alert(1)>', titleKo: null, summary: '<script>', url: 'javascript:alert(1)', publisher: '<b>', at: new Date(now).toISOString(),
    coverage: 2, paywall: true, related: [{ publisher: 'R', title: 't', url: 'javascript:1' }] });
  assert.ok(!html.includes('<img')); assert.ok(!html.includes('<script>')); assert.ok(!html.includes('href="javascript:'));
  assert.ok(html.includes('NEW')); assert.ok(html.includes('유료')); assert.ok(!html.includes('news-related'), '안전한 링크가 없으면 관련 보도 목록을 만들지 않는다');
  const row = latestCard({ title: 'T', url: 'https://techcrunch.com/a', publisher: 'TechCrunch', at: new Date(now).toISOString() });
  assert.ok(row.includes('href="https://techcrunch.com/a"') && row.includes('target="_blank"') && row.includes('noopener'));
});

test('AI NEWS API는 로그인 없이 열리지 않는다', async () => {
  const res = await worker.fetch(new Request('https://japis.example/api/news'), { SESSION_SECRET: 'test-secret-not-for-production', SESSIONS: kv(), DB: { prepare() { return { bind() { return this; }, async first() { return null; }, async all() { return { results: [] }; }, async run() {} }; } } }, {});
  assert.equal(res.status, 401);
});

test('매시 예약 작업은 뉴스만 갱신하고 하루 정리 작업과 섞지 않는다', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('x', { status: 500 }));
  const waits = [];
  let dbUsed = false;
  await worker.scheduled({ cron: '3 * * * *' }, { SESSIONS: kv(), DB: { prepare() { dbUsed = true; throw new Error('no'); } } }, { waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  assert.equal(waits.length, 1); assert.equal(dbUsed, false);
});
