import test from 'node:test';
import assert from 'node:assert/strict';
import { decode, stripHtml, parseDate, parseFeed, parseHn, safeUrl, isAi, aboutAi, lowQuality, features, cluster, rank, storyGroups, applyMerges, mergeSameEvents, community,
  applyJudgement, judgeImportance, selectTop, translate, buildNews, newsFeed, settledPool, fetchAll, SOURCES, BING_FALLBACK, allowedArticle, latestArticles, googlePopularity } from './news.js';
import { topCard, latestCard, communityCard, builtLine, warningHtml, safeNewsUrl } from '../web/public/news.js';
import { SERVICES } from './services.js';
import worker from './index.js';

const now = Date.parse('2026-10-03T03:00:00Z');
const H = 3600000;
const src = (id) => SOURCES.find((s) => s.id === id) || ({ id, name: id, kind: id.startsWith('gnews') ? 'google' : id, lang: 'en' });
const item = (over = {}) => ({ source: 'techcrunch', kind: 'news', publisher: 'TechCrunch', title: 'OpenAI launches new reasoning model for developers', url: 'https://techcrunch.com/a',
  summary: '', at: now - H, lang: 'en', paywall: false, ...over });
const fast = (env) => ({ NEWS_GOOGLE_GAP_MS: 0, ...env });
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

test('RSS · Atom · Google 뉴스 · Techmeme · Bing 항목을 같은 모양으로 읽는다', () => {
  const rss = `<rss><channel><item><title>AI 기사 &quot;하나&quot;</title><link>https://www.aitimes.com/news/articleView.html?idxno=1</link>
    <description><![CDATA[<p>요약입니다</p>]]></description><pubDate>2026-10-03 07:00:00</pubDate></item>
    <item><title>링크 없음</title><pubDate>2026-10-03 07:00:00</pubDate></item>
    <item><title>나쁜 링크</title><link>javascript:alert(1)</link><pubDate>2026-10-03 07:00:00</pubDate></item></channel></rss>`;
  const a = parseFeed(rss, src('aitimes'));
  assert.equal(a.length, 1);
  assert.equal(a[0].title, 'AI 기사 "하나"'); assert.equal(a[0].summary, '요약입니다'); assert.equal(a[0].lang, 'ko'); assert.equal(a[0].kind, 'news');

  const atom = `<feed><entry><updated>2026-10-02T23:00:00Z</updated><published>2026-10-02T19:00:48Z</published><link rel="alternate" type="text/html" href="https://www.theinformation.com/articles/x"/>
    <title>OpenAI Hires Official</title><content type="html">&lt;p&gt;Teaser text.&lt;/p&gt;</content></entry></feed>`;
  const b = parseFeed(atom, src('theinformation'));
  assert.equal(b[0].url, 'https://www.theinformation.com/articles/x'); assert.equal(b[0].summary, 'Teaser text.'); assert.equal(b[0].paywall, true);
  assert.equal(b[0].at, Date.parse('2026-10-02T19:00:48Z'), '수정 시각(updated)보다 최초 발행 시각(published)을 쓴다');

  const google = `<rss><channel><item><title>Big AI deal - Reuters</title><link>https://news.google.com/rss/articles/abc?oc=5</link>
    <pubDate>Fri, 02 Oct 2026 20:46:00 GMT</pubDate><description>&lt;a href="x"&gt;Big AI deal&lt;/a&gt;</description><source url="https://www.reuters.com">Reuters</source></item>
    <item><title>Second - ABC News - Breaking News, Latest News and Videos</title><link>https://news.google.com/rss/articles/def</link><pubDate>Fri, 02 Oct 2026 20:46:00 GMT</pubDate><source url="https://abcnews.go.com">ABC News - Breaking News, Latest News and Videos</source></item></channel></rss>`;
  const c = parseFeed(google, src('gnews-en'));
  assert.deepEqual(c.map((i) => [i.title, i.publisher, i.kind]), [['Big AI deal', 'Reuters', 'google'], ['Second', 'ABC News', 'google']]);
  assert.equal(c[0].summary, '');

  const tm = `<rss><channel><item><title>Apple tightens macOS access for AI agents (Jane Doe/TechCrunch)</title><link>https://www.techmeme.com/261002/p1#a1</link>
    <description><![CDATA[<A HREF="https://techcrunch.com/2026/10/02/apple"><IMG SRC="x"></A><P>Jane Doe / TechCrunch:<BR><B>Apple tightens</B>&nbsp; &mdash;&nbsp; Apple said on Friday it will add controls &hellip; </P>]]></description>
    <pubDate>Fri, 02 Oct 2026 19:55:35 -0400</pubDate></item></channel></rss>`;
  const d = parseFeed(tm, src('techmeme'));
  assert.equal(d[0].title, 'Apple tightens macOS access for AI agents'); assert.equal(d[0].publisher, 'TechCrunch');
  assert.equal(d[0].url, 'https://techcrunch.com/2026/10/02/apple'); assert.match(d[0].summary, /Apple said on Friday/);

  const bing = `<rss><channel><item><title>우주로 간 인공지능</title><link>http://www.bing.com/news/apiclick.aspx?ref=FexRss&amp;url=https%3a%2f%2fwww.hani.co.kr%2farti%2f1.html&amp;c=1</link>
    <description>구글이 시험위성을 발사했다.</description><pubDate>Fri, 02 Oct 2026 03:27:00 GMT</pubDate><News:Source>한겨레 on MSN</News:Source></item></channel></rss>`;
  const e = parseFeed(bing, BING_FALLBACK.find((s) => s.lang === 'ko'));
  assert.equal(e[0].url, 'https://www.hani.co.kr/arti/1.html'); assert.equal(e[0].publisher, '한겨레'); assert.equal(e[0].kind, 'news');
});

test('Hacker News는 점수가 낮은 글을 빼고, 언론사 기사를 가리키면 그 매체 보도로도 센다', () => {
  const hits = parseHn({ hits: [
    { objectID: '1', title: 'Claude ships agents', url: 'https://www.reuters.com/tech/x', points: 120, num_comments: 40, created_at: '2026-10-03T01:00:00Z' },
    { objectID: '2', title: 'Ask HN: AI?', points: 30, created_at: '2026-10-03T01:00:00Z' },
    { objectID: '3', title: 'tiny', url: 'https://a.example', points: 3, created_at: '2026-10-03T01:00:00Z' },
  ] });
  assert.equal(hits.length, 2);
  assert.equal(hits[0].publisher, 'Reuters'); assert.equal(hits[0].newsDomain, true); assert.equal(hits[0].hn.points, 120); assert.equal(hits[0].hn.id, '1');
  assert.equal(hits[1].url, 'https://news.ycombinator.com/item?id=2'); assert.equal(hits[1].newsDomain, false);
});

test('AI 판정과 링크 검사', () => {
  assert.ok(isAi('Nvidia unveils new GPU')); assert.ok(isAi('오픈AI, 새 모델 공개')); assert.ok(!isAi('Crypto custodian lays off staff'));
  assert.ok(!isAi('Said the chairman')); // 부분 단어 'ai' 는 AI 가 아니다
  assert.equal(safeUrl('javascript:alert(1)'), ''); assert.equal(safeNewsUrl('data:text/html,1'), '');
});

test('금액 표기를 맞추고, 한국어는 조사가 달라도 겹치게 쪼갠다', () => {
  assert.ok(features('Amazon seeks to offload $8bn of Nvidia chips').has('$8b'));
  assert.ok(features('Amazon to Move $8 Billion of Chips').has('$8b'));
  const a = features('하나은행도 AI 해킹 뚫렸다'), b = features('하나은행, 해킹 공격으로 유출');
  assert.ok(a.has('하나') && b.has('하나') && a.has('해킹') && b.has('해킹'));
  assert.ok(!features('[속보] 해킹').has('속보'));
});

test('같은 이야기를 다룬 기사들을 하나로 묶고, 다른 이야기는 따로 둔다', () => {
  const groups = cluster([
    item(),
    item({ source: 'verge', publisher: 'The Verge', url: 'https://theverge.com/b', title: 'OpenAI launches a new reasoning model' }),
    item({ source: 'gnews-en', kind: 'google', publisher: 'Reuters', url: 'https://news.google.com/c', title: 'OpenAI launches reasoning model for developers, says CEO' }),
    item({ url: 'https://techcrunch.com/d', title: 'Apple tightens macOS disk access controls' }),
    item({ source: 'ft', publisher: 'Financial Times', url: 'https://ft.com/e', title: 'Amazon seeks to offload $8bn of Nvidia chips to investors' }),
    item({ source: 'gnews-en', kind: 'google', publisher: 'Bloomberg', url: 'https://news.google.com/f', title: 'Amazon to offload $8 billion of Nvidia chips, FT says' }),
  ]);
  assert.equal(groups.length, 3);
  assert.deepEqual(groups.map((g) => g.items.length), [3, 1, 2]);
});

test('여러 매체가 다룬 이야기가 위로 오고, 매체 가중치 없이 먼저 나온 무료 기사가 대표가 된다', () => {
  const items = [
    item({ source: 'aitimes', publisher: 'AI타임스', url: 'https://aitimes.com/solo', title: '국내 스타트업 AI 반도체 시제품', lang: 'ko' }),
    item({ source: 'theinformation', publisher: 'The Information', url: 'https://theinformation.com/x', title: 'OpenAI launches new reasoning model for developers', paywall: true, at: now - 3 * H }),
    item({ at: now - 2 * H }),
    item({ source: 'verge', publisher: 'The Verge', url: 'https://theverge.com/b', title: 'OpenAI launches a new reasoning model' }),
    item({ source: 'gnews-en', kind: 'google', publisher: 'Reuters', url: 'https://news.google.com/r', title: 'OpenAI launches reasoning model for developers' }),
  ];
  const { top, stories } = rank(items, now, { top: [{ url: 'https://aitimes.com/solo', related: [] }] });
  assert.equal(stories, 2);
  assert.equal(top[0].url, 'https://techcrunch.com/a', '유료 The Information 보다 무료 기사를 대표로');
  assert.equal(top[0].coverage, 4);
  assert.deepEqual(top[0].related.map((r) => r.publisher).sort(), ['Reuters', 'The Information', 'The Verge']);
  assert.equal(top[0].firstAt, new Date(now - 3 * H).toISOString(), '최초 보도 시각은 묶음에서 가장 이른 기사');
  assert.ok(top[0].reasons.includes('독립 매체 4곳 보도'));
  assert.equal(top[0].previousRank, null);
  assert.equal(top[1].previousRank, 1);
  assert.equal(top[1].titleKo, '국내 스타트업 AI 반도체 시제품');
});

test('Top 은 최초 보도 24시간 이내만 — 어제 처음 나온 이야기는 오늘 다시 보도돼도 빠진다', () => {
  const items = [
    item({ url: 'https://techcrunch.com/old', title: 'Court dismisses Google AI Overviews lawsuit', at: now - 30 * H }),
    item({ source: 'verge', publisher: 'The Verge', url: 'https://theverge.com/old', title: 'Judge dismisses Google AI Overviews lawsuit filed by publishers', at: now - 2 * H }),
    item({ url: 'https://techcrunch.com/fresh', title: 'Nvidia ships new inference chip', at: now - 5 * H }),
  ];
  const { top } = rank(items, now);
  assert.deepEqual(top.map((t) => t.url), ['https://techcrunch.com/fresh']);
});

test('HN 에서만 화제인 글과 공식 발표만 있는 소식은 뉴스 Top 에 들지 않고, HN 글은 커뮤니티 화제로 간다', () => {
  const hnOnly = { ...item({ source: 'hn', kind: 'hn', publisher: 'github.com', url: 'https://github.com/lego', title: 'Show HN: Lego AI generator', newsDomain: false }), hn: { id: '9', points: 300, comments: 10, url: 'https://news.ycombinator.com/item?id=9' } };
  const official = item({ source: 'openai', kind: 'official', publisher: 'OpenAI', url: 'https://openai.com/x', title: 'Introducing a sandbox for agents' });
  const news = item({ url: 'https://techcrunch.com/z', title: 'Mistral raises funding round' });
  const { top } = rank([hnOnly, official, news], now);
  assert.deepEqual(top.map((t) => t.url), ['https://techcrunch.com/z']);
  const talk = community([hnOnly, news], now, { community: [{ hn: { id: '9', points: 250 } }] });
  assert.equal(talk.length, 1); assert.equal(talk[0].delta, 50);
});

test('한 매체는 대표 기사로 2건까지만 오른다', () => {
  const titles = ['AI robot vacuum learns stairs', 'AI chip startup files patent', 'AI model card standards debated', 'AI seed round closes quietly', 'Court weighs AI copyright claim'];
  const many = titles.map((title, i) => item({ url: `https://techcrunch.com/${i}`, title }));
  assert.equal(rank(many, now).top.length, 2);
});

test('AI 가 같은 사건이라 한 묶음은 합치되, 제목이 거의 안 겹치는 같은 언어 묶음은 합치지 않는다', async () => {
  const items = [
    item({ source: 'yonhap', publisher: '연합뉴스', url: 'https://yna.co.kr/1', title: '하나은행도 AI 해킹 뚫렸다…89명 개인정보 유출', lang: 'ko' }),
    item({ source: 'gnews-ko', kind: 'google', publisher: '조선일보', url: 'https://news.google.com/2', title: '은행 6곳에 무차별 AI 해킹… 4곳은 개인정보 유출', lang: 'ko' }),
    item({ url: 'https://techcrunch.com/apple', title: 'Apple tightens macOS Full Disk Access for AI agents' }),
    item({ source: 'ft', publisher: 'Financial Times', url: 'https://ft.com/amzn', title: 'Amazon seeks to offload $8bn of Nvidia AI chips to investors' }),
    item({ source: 'gnews-ko', kind: 'google', publisher: 'ebn', url: 'https://news.google.com/3', title: '애플, AI 에이전트 정보유출 우려에 접근권한 통제 강화', lang: 'ko' }),
  ];
  const groups = storyGroups(items, now);
  const idx = (re) => groups.findIndex((g) => g.items.some((i) => re.test(i.title)));
  const merged = applyMerges(groups, [[idx(/하나은행/), idx(/은행 6곳/)], [idx(/Apple/), idx(/Amazon/)], [idx(/Apple/), idx(/애플/)]], now);
  const sizes = merged.map((g) => g.items.length).sort();
  assert.deepEqual(sizes, [1, 2, 2], '은행 두 기사·애플 한영 기사는 합치고 애플·아마존은 따로');
  assert.ok(merged.find((g) => g.items.some((i) => /Apple/.test(i.title))).items.some((i) => /애플/.test(i.title)));

  assert.equal(idx(/하나은행/), idx(/은행 6곳/), '같은 은행 해킹 기사는 제목만으로도 묶인다');
  const env = { AI: { async run() { return { response: `{"same":[[${idx(/Apple/)},${idx(/애플/)}]]}` }; } } };
  assert.equal((await mergeSameEvents(env, groups, now)).length, groups.length - 1);
  const broken = { AI: { async run() { throw new Error('quota'); } } };
  assert.equal((await mergeSameEvents(broken, groups, now)).length, groups.length, 'AI 가 실패하면 제목 묶음 그대로');
});

test('동시에 6개까지만 가져온다(Workers 동시 연결 한도)', async () => {
  let running = 0, peak = 0;
  const tasks = Array.from({ length: 20 }, (_, i) => async () => { running++; peak = Math.max(peak, running); await new Promise((r) => setTimeout(r, 2)); running--; if (i === 3) throw new Error('x'); return i; });
  const out = await settledPool(tasks);
  assert.equal(peak, 6); assert.equal(out[3].status, 'rejected'); assert.equal(out[19].value, 19);
});

test('영어 기사 번역은 AI 답만 덧붙이고, 한 번 더 시도한 뒤에도 실패하면 원문을 그대로 둔다', async () => {
  const top = [{ title: 'A', summary: 's', lang: 'en', titleKo: null, summaryKo: null }, { title: '가', lang: 'ko', titleKo: '가' }];
  let prompt;
  await translate({ AI: { async run(_, opts) { prompt = opts.messages[1].content; return { response: '```json\n{"items":[{"i":0,"title_ko":"에이","summary_ko":"요약"},{"i":9,"title_ko":"x"}]}\n```' }; } } }, top);
  assert.equal(top[0].titleKo, '에이'); assert.equal(top[0].summaryKo, null, '제목만 번역한다');
  assert.equal(JSON.parse(prompt).length, 1, '한국어 기사는 번역하지 않는다');
  let calls = 0;
  const flaky = [{ title: 'C', lang: 'en', titleKo: null }];
  await translate({ AI: { async run() { calls++; if (calls === 1) return { response: '{"items":[{"i":0,"title_ko":' }; return { response: '{"items":[{"i":0,"title_ko":"씨"}]}' }; } } }, flaky);
  assert.equal(flaky[0].titleKo, '씨');
  const failing = [{ title: 'B', lang: 'en', titleKo: null }];
  await translate({ AI: { async run() { throw new Error('quota'); } } }, failing);
  assert.equal(failing[0].titleKo, null);
});

const rssAt = (title, link, at) => `<rss><item><title>${title}</title><link>${link}</link><pubDate>${new Date(at).toUTCString()}</pubDate></item></rss>`;

test('스냅숏: 일부 매체가 실패해도 만들고, 오래되거나 없을 때만 다시 모으며 수동 갱신은 10분 간격', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url) => {
    calls++;
    const u = String(url);
    if (u.includes('techcrunch')) return new Response(rssAt('OpenAI launches model', 'https://techcrunch.com/a', now - 60000));
    if (u.includes('theinformation')) return new Response(`<feed><entry><title>Crypto layoffs</title><link href="https://theinformation.com/c"/><published>${new Date(now).toISOString()}</published></entry></feed>`);
    if (u.includes('algolia')) return Response.json({ hits: [] });
    if (u.includes('news.google.com') && !u.includes('anthropic.com')) return new Response(`<rss><item><title>OpenAI launches model - Reuters</title><link>https://news.google.com/x</link><pubDate>${new Date(now).toUTCString()}</pubDate><source>Reuters</source></item></rss>`);
    return new Response('nope', { status: 503 });
  });
  const env = fast({ SESSIONS: kv() });
  const first = await newsFeed(env, { now });
  assert.equal(first.top.length, 1); assert.equal(first.top[0].publisher, 'TechCrunch'); assert.equal(first.top[0].coverage, 1);
  assert.equal(first.latest.length, 1, 'AI와 무관한 The Information 글은 뺀다');
  assert.equal(first.sources.find((s) => s.id === 'bloomberg').ok, false);
  assert.equal(first.sources.find((s) => s.id === 'bloomberg').error, '수집 실패(HTTP 503)');
  assert.ok(first.warnings.some((w) => w.includes('Bloomberg')), '요청한 출처 실패는 경고');
  assert.ok(!first.warnings.some((w) => w.includes('Google 뉴스')));
  assert.deepEqual(first.stats, { articles: 1, stories: 1 });
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

test('원문 수집은 지정한 5개 매체만 허용하고 검색 재전재·가짜 도메인은 제외한다', () => {
  assert.deepEqual(SOURCES.map((s) => s.name).sort(), ['AI타임스', 'Bloomberg', 'Reuters', 'TechCrunch', 'The Information'].sort());
  assert.ok(allowedArticle(item()));
  assert.ok(allowedArticle(item({ source: 'reuters', url: 'https://www.reuters.com/technology/a' })));
  for (const url of ['https://techcrunch.com.evil.com/a', 'https://msn.com/a', 'https://theverge.com/a']) assert.ok(!allowedArticle(item({ url })));
  assert.ok(!allowedArticle(item({ source: 'gnews-en' })));
});

test('Google News 동일 사건 보도 URL 수로 정렬하고 중복·다른 사건은 세지 않는다', async (t) => {
  const groups = storyGroups([
    item({ title: 'OpenAI launches new reasoning model for developers' }),
    item({ title: 'EU approves AI copyright regulation', url: 'https://techcrunch.com/b' }),
  ], now);
  t.mock.method(globalThis, 'fetch', async (url) => {
    const title = new URL(url).searchParams.get('q');
    const stories = title.includes('OpenAI') ? [
      ['OpenAI launches new reasoning model for developers', 'https://news.google.com/1'],
      ['OpenAI launches reasoning model for developers', 'https://news.google.com/2'],
      ['OpenAI launches reasoning model for developers', 'https://news.google.com/2'],
      ['OpenAI sued by investors over funding dispute', 'https://news.google.com/3'],
    ] : [['EU approves AI copyright regulation', 'https://news.google.com/4']];
    return new Response('<rss>' + stories.map(([title, url]) => '<item><title>' + title + '</title><link>' + url + '</link><pubDate>' + new Date(now).toUTCString() + '</pubDate><source>Other outlet</source></item>').join('') + '</rss>');
  });
  const ranked = await googlePopularity(fast({}), groups, now);
  assert.deepEqual(ranked.map((g) => g.popularity.reports), [2, 1]);
  assert.ok(ranked.every((g) => g.items.every(allowedArticle)), '다른 매체는 인기도 집계에만 사용');
});

test('Google 인기도 실패를 Bing 점수로 대체하지 않고 경고한다', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (String(url).startsWith('https://techcrunch.com/')) return new Response(rssAt('OpenAI launches model', 'https://techcrunch.com/a', now - H));
    return new Response('blocked', { status: 503 });
  });
  const snap = await buildNews(fast({ SESSIONS: kv() }), now);
  assert.equal(snap.top[0].googlePopularity.ok, false);
  assert.equal(snap.top[0].googlePopularity.reports, 0);
  assert.ok(snap.warnings.some((w) => w.includes('Google News')));
  assert.deepEqual(snap.community, []);
});

test('국내·해외 참고 기사는 각각 최대 10개이며 중복·행사·다른 매체를 제외한다', () => {
  const articles = Array.from({ length: 18 }, (_, i) => item({ url: 'https://techcrunch.com/' + i, title: 'OpenAI model release ' + i, at: now - i * 1000 }));
  const korean = Array.from({ length: 18 }, (_, i) => item({ source: 'aitimes', lang: 'ko', title: '오픈AI 모델 출시 ' + i, url: 'https://aitimes.com/' + i, at: now - i * 1000 }));
  const list = latestArticles([...articles, ...korean, articles[0], item({ title: 'AI seminar event' }), item({ url: 'https://other.com/a' })], now);
  assert.equal(list.filter((i) => i.lang === 'ko').length, 10);
  assert.equal(list.filter((i) => i.lang === 'en').length, 10);
  assert.ok(list.every((i) => i.summary === ''));
});

test('인기도 순위 Top 5는 한 매체라도 최대 5건을 선정한다', () => {
  const titles = ['OpenAI launches model', 'EU approves AI regulation', 'Nvidia ships inference chip', 'Anthropic raises funding', 'AI robot learns stairs', 'AI copyright lawsuit settled'];
  const groups = storyGroups(titles.map((title, i) => item({ title, url: 'https://techcrunch.com/' + i })), now);
  const popular = groups.map((g, i) => ({ ...g, popularity: { ok: true, reports: 10 - i } }));
  assert.equal(selectTop(popular).length, 5);
});

test('수집부터 번역까지: 편집 중요도가 Google 순서를 바꾸지 않고 참고 제목도 한글로 표시한다', async (t) => {
  const titles = ['OpenAI launches reasoning model', 'EU approves AI copyright regulation'];
  const feedItem = (title, url) => `<item><title>${title}</title><link>${url}</link><pubDate>${new Date(now - H).toUTCString()}</pubDate></item>`;
  t.mock.method(globalThis, 'fetch', async (url) => {
    const u = String(url);
    if (u.startsWith('https://techcrunch.com/')) return new Response('<rss>' + titles.map((title, i) => feedItem(title, `https://techcrunch.com/${i}`)).join('') + '</rss>');
    if (u.startsWith('https://news.google.com/')) {
      const title = new URL(u).searchParams.get('q').replace(' when:1d', '');
      return new Response('<rss>' + Array.from({ length: title.includes('OpenAI') ? 3 : 1 }, (_, i) => feedItem(title, `https://news.google.com/${title.includes('OpenAI') ? 'a' : 'b'}${i}`)).join('') + '</rss>');
    }
    return new Response('no', { status: 503 });
  });
  const env = fast({ SESSIONS: kv(), AI: { async run(_, options) {
    const prompt = options.messages[0].content, rows = JSON.parse(options.messages[1].content);
    if (prompt.includes('title_ko')) {
      assert.ok(rows.every((r) => !('snippet' in r)), '번역에는 제목만 전달');
      return { response: { items: rows.map((r) => ({ i: r.i, title_ko: '한글 제목 ' + r.i })) } };
    }
    if (prompt.includes('importance 1~5')) return { response: { items: rows.map((r) => ({ i: r.i, ai: true, importance: r.titles[0].includes('EU') ? 5 : 3, type: 'policy' })) } };
    return { response: { same: [] } };
  } } });
  const snap = await buildNews(env, now);
  assert.deepEqual(snap.top.map((r) => r.googlePopularity.reports), [3, 1]);
  assert.equal(snap.top[0].title, titles[0]);
  assert.ok([...snap.top, ...snap.latest].every((r) => r.titleKo.startsWith('한글 제목')));
  assert.ok(latestCard(snap.latest[0]).includes('한글 제목'));
});

test('Google 뉴스 주소는 동시에 부르지 않고 하나씩 띄워 부른다', async (t) => {
  let running = 0, peak = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    running++; peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, 5)); running--;
    return new Response('<rss></rss>');
  });
  const sources = Array.from({ length: 3 }, (_, i) => ({ id: 'g' + i, name: 'Google', kind: 'google', lang: 'en', url: 'https://news.google.com/rss/search?q=' + i }));
  const out = await fetchAll(sources, now, { gap: 1 });
  assert.equal(out.length, sources.length);
  assert.equal(peak, 1);
});

test('AI 주제 판정과 뉴스가 아닌 글 거르기', () => {
  assert.ok(aboutAi('OpenAI launches GPT-6')); assert.ok(aboutAi('삼성, 생성형 AI 탑재 갤럭시 공개')); assert.ok(aboutAi('Nvidia ships new inference chip'));
  assert.ok(!aboutAi('Nvidia’s $235 Billion Buyback Offers a Powerful Lesson for Founders'), '엔비디아 이름만으로는 AI 기사가 아니다');
  assert.ok(!aboutAi('SK하이닉스, 데이터센터용 메모리 증산'));
  for (const t of ['[월요칼럼] AI 시대, 산업경쟁력의 기준이 바뀐다', 'I have news for Big Tech. We don\'t want AI to do everything | Opinion', '[특징주] 솔트룩스 AI 기대에 급등',
    '중부발전, AI 안전 세미나 개최', 'AWS Counters AI Backlash | The Morning Download for Oct. 2', 'How to use ChatGPT agents']) assert.ok(lowQuality(t), t);
  for (const t of ['OpenAI launches new reasoning model', '구글, 제미나이 AI 요금 개편', 'Trump names AI czar']) assert.ok(!lowQuality(t), t);
  const groups = storyGroups([
    item({ url: 'https://techcrunch.com/col', title: 'Opinion: AI is overhyped' }),
    item({ url: 'https://techcrunch.com/buy', title: 'Nvidia stock jumps after buyback' }),
    item({ url: 'https://techcrunch.com/ok', title: 'Anthropic releases Claude update' }),
  ], now);
  assert.deepEqual(groups.map((g) => g.lead.url), ['https://techcrunch.com/ok']);
});

test('편집 판정: AI 가 주제가 아니거나 중요도 3 미만은 빼고, 신제품 발표·높은 중요도는 앞으로', async () => {
  const groups = storyGroups([
    item({ url: 'https://techcrunch.com/1', title: 'AI startup hosts community meetup in Austin' }),
    item({ url: 'https://theverge.com/2', source: 'verge', publisher: 'The Verge', title: 'Google launches Gemini 4 model' }),
    item({ url: 'https://ft.com/3', source: 'ft', publisher: 'Financial Times', title: 'Bank uses AI chatbot for loan forms' }),
    item({ url: 'https://wired.com/4', source: 'wired', publisher: 'Wired', title: 'EU finalizes AI Act enforcement rules' }),
  ], now);
  const at = (re) => groups.findIndex((g) => re.test(g.lead.title));
  const judged = applyJudgement(groups, [
    { i: at(/meetup/), ai: true, importance: 2, type: 'other' },
    { i: at(/Gemini/), ai: true, importance: 5, type: 'launch' },
    { i: at(/loan/), ai: false, importance: 3, type: 'business' },
    { i: at(/AI Act/), ai: true, importance: 4, type: 'policy' },
  ]);
  assert.deepEqual(judged.map((g) => g.lead.title), ['Google launches Gemini 4 model', 'EU finalizes AI Act enforcement rules']);
  const top = selectTop(judged);
  assert.equal(top[0].importance, 5); assert.equal(top[0].type, 'launch'); assert.ok(top[0].reasons.includes('신제품·모델 발표'));

  let prompt;
  const env = { AI: { async run(_, o) { prompt = JSON.parse(o.messages[1].content); return { response: `{"items":[{"i":${at(/Gemini/)},"ai":true,"importance":5,"type":"launch"}]}` }; } } };
  const viaAi = await judgeImportance(env, groups);
  assert.equal(prompt.length, groups.length);
  assert.equal(viaAi[0].lead.title, 'Google launches Gemini 4 model', '판정이 일부만 오면 판정된 것을 앞에, 판정 없는 후보로 채운다');
  const broken = await judgeImportance({ AI: { async run() { throw new Error('quota'); } } }, groups);
  assert.equal(broken.length, groups.length, 'AI 가 실패하면 규칙 필터 결과 그대로');
  const distinct = ['OpenAI ships agents', 'Anthropic raises funds', 'Gemini tops benchmark', 'Mistral opens Paris lab', 'Perplexity sued by publishers', 'xAI hires chip team', 'Copilot adds voice'];
  assert.equal(rank(distinct.map((title, i) => item({ url: `https://x${i}.com/a`, publisher: `P${i}`, title })), now).top.length, 5, 'Top 5 까지만');
});

test('기사 시각이 수정으로 늦어져도 처음 본 시각을 쓴다', async (t) => {
  let at = now - 2 * H;
  t.mock.method(globalThis, 'fetch', async (url) => {
    const u = String(url);
    if (u.includes('techcrunch')) return new Response(rssAt('OpenAI launches model', 'https://techcrunch.com/a', at));
    if (u.includes('algolia')) return Response.json({ hits: [] });
    return new Response('x', { status: 500 });
  });
  const env = fast({ SESSIONS: kv() });
  await buildNews(env, now);
  at = now + 20 * H;
  const later = await buildNews(env, now + 23 * H);
  assert.equal(later.top.length, 0, '최초 보도가 25시간 전이라 빠진다');
});

test('모든 매체가 실패하면 빈 순위를 저장하지 않는다', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('x', { status: 500 }));
  const env = fast({ SESSIONS: kv() });
  const snap = await buildNews(env, now);
  assert.equal(snap.top.length, 0); assert.equal(env.SESSIONS.values.size, 0);
});

test('카드 HTML은 이스케이프하고 스크립트 링크를 만들지 않는다', () => {
  const html = topCard({ rank: 1, previousRank: null, title: '<img src=x onerror=alert(1)>', titleKo: null, summary: '<script>', url: 'javascript:alert(1)', publisher: '<b>', at: new Date(now).toISOString(),
    firstAt: new Date(now).toISOString(), coverage: 2, paywall: true, reasons: ['<i>x</i>'], related: [{ publisher: 'R', title: 't', url: 'javascript:1' }] });
  assert.ok(!html.includes('<img')); assert.ok(!html.includes('<script>')); assert.ok(!html.includes('<i>x')); assert.ok(!html.includes('href="javascript:'));
  assert.ok(html.includes('NEW')); assert.ok(html.includes('유료')); assert.ok(html.includes('최초 보도')); assert.ok(!html.includes('news-related'), '안전한 링크가 없으면 관련 보도 목록을 만들지 않는다');
  const row = latestCard({ title: 'T', url: 'https://techcrunch.com/a', publisher: 'TechCrunch', at: new Date(now).toISOString() });
  assert.ok(row.includes('href="https://techcrunch.com/a"') && row.includes('target="_blank"') && row.includes('noopener'));
  const talk = communityCard({ rank: 1, title: '<b>', url: 'javascript:1', publisher: 'x', at: new Date(now).toISOString(), hn: { points: 5, comments: 1, url: 'https://news.ycombinator.com/item?id=1' }, delta: 3 });
  assert.ok(!talk.includes('<b>') && !talk.includes('javascript:') && talk.includes('+3점'));
  assert.match(builtLine({ builtAt: new Date(now).toISOString(), windowHours: 24, stats: { articles: 400, stories: 250 } }), /기사 400건\(중복 포함\)을 이야기 250개로 묶어 비교/);
  assert.ok(warningHtml({ warnings: ['<b>'] }).includes('&lt;b&gt;')); assert.equal(warningHtml({ warnings: [] }), '');
});

test('메뉴: AI NEWS 는 개인서비스에, 예전 Jaden AI SNS 는 다시 제자리에', () => {
  const news = SERVICES.find((s) => s.key === 'news'), sns = SERVICES.find((s) => s.key === 'sns');
  assert.equal(news.group, 'personal'); assert.equal(news.route, '#/news');
  assert.equal(sns.label, 'Jaden AI SNS'); assert.equal(sns.route, '#/sns');
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
