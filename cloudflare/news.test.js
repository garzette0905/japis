import test from 'node:test';
import assert from 'node:assert/strict';
import { decode, stripHtml, parseDate, parseFeed, parseListing, parseMeta, isAi, lowQuality, cluster, candidates, ruleCategory, scoreCandidate, selectNews, applySeen,
  applyVotes, translate, buildNews, newsFeed, rescoreNews, voteNews, submitLikes, SOURCES, allowedArticle, learnedSource, translationRows } from './news.js';
import { packVec, unpackVec, cosine, textDate, normUrl } from './news-util.js';
import { parseUrls, loadPrefs, kindOfDomain, listPrefs } from './news-prefs.js';
import { topCard, moreRow, builtLine, warningHtml, safeNewsUrl, topListsHtml, sourcesLine } from '../web/public/news.js';
import { SERVICES } from './services.js';
import worker from './index.js';

const now = Date.parse('2026-10-09T03:00:00Z');
const H = 3600000;
const src = (id) => SOURCES.find((s) => s.id === id);
function kv() {
  const values = new Map();
  return { values, async get(k, type) { const v = values.get(k); return type === 'json' ? JSON.parse(v || 'null') : v ?? null; }, async put(k, v) { values.set(k, v); }, async delete(k) { values.delete(k); } };
}

/** news-prefs.js 가 쓰는 질의만 흉내 내는 작은 D1. */
function d1() {
  const feedback = [], sources = [];
  let id = 0;
  const db = {
    feedback, sources,
    prepare(sql) {
      let args = [];
      const stmt = {
        bind(...a) { args = a; return stmt; },
        async all() {
          if (/FROM news_feedback ORDER BY id DESC LIMIT 400/.test(sql)) return { results: [...feedback].sort((a, b) => b.id - a.id) };
          if (/SELECT url, vote FROM news_feedback/.test(sql)) return { results: [...feedback].sort((a, b) => b.id - a.id) };
          if (/FROM news_sources/.test(sql)) return { results: [...sources] };
          return { results: [] };
        },
        async first() { return null; },
        async run() {
          if (/^INSERT INTO news_feedback/.test(sql)) {
            const [url, link, vote, origin, title, summary, domain, vector, user_id, created_at] = args;
            const old = feedback.find((f) => f.url === url);
            if (old) Object.assign(old, { vote, origin, title, summary, vector: vector ?? old.vector, user_id });
            else feedback.push({ id: ++id, url, link, vote, origin, title, summary, domain, vector, user_id, created_at });
          } else if (/^INSERT INTO news_sources/.test(sql)) {
            const [domain, name, feed_url, format, kind, link_prefix, created_at] = args;
            const i = sources.findIndex((s) => s.domain === domain);
            const row = { domain, name, feed_url, format, kind, link_prefix, created_at };
            if (i >= 0) sources[i] = row; else sources.push(row);
          } else if (/DELETE FROM news_feedback WHERE url/.test(sql)) feedback.splice(feedback.findIndex((f) => f.url === args[0]) >>> 0, feedback.some((f) => f.url === args[0]) ? 1 : 0);
          else if (/DELETE FROM news_feedback WHERE id/.test(sql)) { const i = feedback.findIndex((f) => f.id === args[0]); if (i >= 0) feedback.splice(i, 1); }
          else if (/DELETE FROM news_sources/.test(sql)) { const i = sources.findIndex((s) => s.domain === args[0]); if (i >= 0) sources.splice(i, 1); }
          return {};
        },
      };
      return stmt;
    },
  };
  return db;
}

// 단어를 해시해 64차원에 담는 가짜 임베딩. 같은 단어가 많을수록 코사인이 크다.
const WORDS = (t) => String(t).toLowerCase().split(/[^a-z0-9가-힣]+/).filter((w) => w.length > 2);
function fakeVec(text) {
  const v = new Array(64).fill(0.01);
  for (const w of WORDS(text)) { let h = 0; for (const ch of w) h = (h * 31 + ch.charCodeAt(0)) >>> 0; v[h % 64] += 1; }
  return v;
}
function fakeAi({ embedFail = false, calls = [] } = {}) {
  return {
    calls,
    async run(model, input) {
      calls.push(model);
      if (model === '@cf/baai/bge-m3') { if (embedFail) throw new Error('quota'); return { shape: [input.text.length, 64], data: input.text.map(fakeVec) }; }
      if (model === '@cf/meta/m2m100-1.2b') return { translated_text: '번역 ' + input.text };
      const payload = JSON.parse(input.messages[1].content);
      if (/편집장/.test(input.messages[0].content)) return { response: { items: payload.map((p) => ({ i: p.i, ai: !/crypto/i.test(p.title), importance: 4, type: 'other' })) } };
      return { response: { items: payload.map((p) => ({ i: p.i, title_ko: '번역: ' + p.title })) } };
    },
  };
}

const rss = (rows) => `<rss><channel>${rows.map(([t, u, at, d = '']) => `<item><title>${t}</title><link>${u}</link><description>${d}</description><pubDate>${new Date(at).toUTCString()}</pubDate></item>`).join('')}</channel></rss>`;

test('RSS 문자열의 CDATA·엔티티·HTML을 걷어내고 날짜를 읽는다', () => {
  assert.equal(decode('<![CDATA[A &amp; B]]>'), 'A & B');
  assert.equal(stripHtml('&lt;p&gt;Hello <b>world</b>&lt;/p&gt;'), 'Hello world');
  assert.equal(parseDate('2026-10-03 07:00:00'), Date.parse('2026-10-02T22:00:00Z'), '시간대 없는 AI타임스 날짜는 서울 시각');
  assert.equal(textDate('Oct 2, 2026 Announcements'), Date.UTC(2026, 9, 2, 12));
  assert.equal(textDate('2026.10.05 리포트'), Date.UTC(2026, 9, 5, 12));
});

test('RSS · Atom · Bing 항목을 같은 모양으로 읽고 원문 사이트만 허용한다', () => {
  const a = parseFeed(`<rss><item><title>AI 기사</title><link>https://www.aitimes.com/news/articleView.html?idxno=1</link><description><![CDATA[<p>요약</p>]]></description><pubDate>2026-10-09 07:00:00</pubDate></item>
    <item><title>나쁜 링크</title><link>javascript:alert(1)</link><pubDate>2026-10-09 07:00:00</pubDate></item></rss>`, src('aitimes'));
  assert.equal(a.length, 1); assert.equal(a[0].lang, 'ko'); assert.equal(a[0].summary, '요약');
  const b = parseFeed(`<feed><entry><updated>2026-10-09T02:00:00Z</updated><published>2026-10-08T19:00:00Z</published><link rel="alternate" href="https://www.theinformation.com/articles/x"/><title>OpenAI hires</title></entry></feed>`, src('theinformation'));
  assert.equal(b[0].at, Date.parse('2026-10-08T19:00:00Z'), '수정 시각보다 최초 발행 시각'); assert.equal(b[0].paywall, true);
  const bing = parseFeed(`<rss><item><title>Bain says AI needs $2 trillion</title><link>https://www.bing.com/news/apiclick.aspx?url=https%3a%2f%2fwww.bain.com%2finsights%2fai-report%2f&amp;c=1</link><pubDate>${new Date(now).toUTCString()}</pubDate><News:Source>Bain</News:Source></item></rss>`, src('bain'));
  assert.equal(bing[0].url, 'https://www.bain.com/insights/ai-report/');
  assert.ok(allowedArticle(bing[0], src('bain')));
  assert.ok(!allowedArticle({ url: 'https://evil-bain.com/x' }, src('bain')), '비슷한 가짜 도메인 제외');
  assert.ok(!allowedArticle({ url: 'https://www.msn.com/x' }, src('consulting')), '포털 재전재 제외');
  assert.ok(allowedArticle({ url: 'https://www.cnbc.com/x' }, src('consulting')), '여러 매체를 모으는 검색은 원문 사이트를 묻지 않는다');
});

test('RSS 가 없는 공식 블로그는 목록 화면에서 글 주소·제목·날짜를 읽는다', () => {
  const html = `<nav><a href="/news">News</a><a href="/careers">Careers</a></nav>
    <a href="/news/claude-frontier-academy"><img src="x.png"><span>Oct 2, 2026</span><span>Announcements</span><h3>Claude Frontier Academy: $100M to train engineers</h3></a>
    <a href="/news/claude-frontier-academy">Read more</a>
    <a href="https://www.anthropic.com/news/cyber-mission"><div>Introducing the Anthropic Cyber Mission program</div></a>
    <a href="https://other.com/news/x"><h3>Other site story here</h3></a>`;
  const got = parseListing(html, src('anthropic'));
  assert.deepEqual(got.map((i) => i.title), ['Claude Frontier Academy: $100M to train engineers', 'Introducing the Anthropic Cyber Mission program']);
  assert.equal(got[0].at, Date.UTC(2026, 9, 2, 12)); assert.equal(got[0].undated, false);
  assert.equal(got[1].undated, true); assert.equal(got[0].kind, 'official');
});

test('기사 페이지의 제목·요약·발행 시각·RSS 주소를 읽는다', () => {
  const m = parseMeta(`<head><title>fallback</title><meta property="og:title" content="State of AI 2026"/><meta name="description" content="McKinsey survey &amp; findings"/>
    <meta property="article:published_time" content="2026-10-02T23:01:00.000Z"/><meta property="og:site_name" content="McKinsey"/>
    <link rel="alternate" type="application/rss+xml" href="/insights/rss"></head>`, 'https://www.mckinsey.com/a/b');
  assert.equal(m.title, 'State of AI 2026'); assert.equal(m.summary, 'McKinsey survey & findings');
  assert.equal(m.at, Date.parse('2026-10-02T23:01:00Z')); assert.equal(m.siteName, 'McKinsey'); assert.deepEqual(m.feeds, ['https://www.mckinsey.com/insights/rss']);
});

test('임베딩은 int8 로 줄여도 코사인 순서를 지킨다', () => {
  const a = unpackVec(packVec(fakeVec('openai launches gpt model agents'))), b = unpackVec(packVec(fakeVec('openai gpt model launch for agents'))), c = unpackVec(packVec(fakeVec('bank earnings quarterly crypto')));
  assert.ok(cosine(a, b) > cosine(a, c)); assert.ok(Math.abs(cosine(a, a) - 1) < 0.01);
  assert.equal(unpackVec('###'), null);
});

test('텍스트 상자 입력: 엔터·쉼표로 여러 주소, 중복·추적 파라미터·이상한 주소 제거', () => {
  assert.deepEqual(parseUrls('https://a.com/x?utm_source=t\nhttps://a.com/x\n javascript:alert(1), https://b.com/y'), ['https://a.com/x?utm_source=t', 'https://b.com/y']);
  assert.equal(normUrl('https://www.aitimes.com/news/articleView.html?idxno=5&utm_medium=x'), 'aitimes.com/news/articleView.html?idxno=5', '기사번호는 남긴다');
  assert.equal(kindOfDomain('openai.com'), 'official'); assert.equal(kindOfDomain('mckinsey.com'), 'report'); assert.equal(kindOfDomain('cnbc.com'), 'news');
});

test('종류 판정: 프런티어 신제품 · 무료 토큰 · 컨설팅 리포트', () => {
  assert.equal(ruleCategory({ title: 'Anthropic launches Claude 5 for developers', kind: 'news' }), 'launch');
  assert.equal(ruleCategory({ title: 'Google gives developers free Gemini API tokens for a month', kind: 'news' }), 'free');
  assert.equal(ruleCategory({ title: '오픈AI, 챗GPT 고급 기능 무료 개방', kind: 'news' }), 'free');
  assert.equal(ruleCategory({ title: 'The state of AI in 2026: global survey', kind: 'report', source: 'mckinsey' }), 'report');
  assert.equal(ruleCategory({ title: 'McKinsey report: agents reshape banking', kind: 'news' }), 'report');
  assert.ok(isAi('엔비디아 GPU 공급')); assert.ok(lowQuality('[기자수첩] AI 거품')); assert.ok(!lowQuality('OpenAI unveils new model'));
});

const cand = (over) => ({ key: over.url, title: 'x', summary: '', url: 'https://techcrunch.com/x', publisher: 'TechCrunch', source: 'techcrunch', kind: 'news', lang: 'en', paywall: false,
  at: now - 2 * H, domain: 'techcrunch.com', coverage: 1, related: [], ...over, key: normUrl(over.url || 'https://techcrunch.com/x') });
const prefsOf = (likes = [], dislikes = [], domains = new Map()) => ({ ok: true, likes, dislikes, sources: [], domains, rows: [...likes, ...dislikes] });
const pref = (title, vote = 1) => ({ title, summary: '', vote, vec: unpackVec(packVec(fakeVec(title))), feat: new Set() });

test('좋아요 기사와 닮은 기사가 위로, 싫어요와 거의 같은 기사는 빠진다', () => {
  const pool = [
    cand({ url: 'https://techcrunch.com/a', title: 'Bank earnings beat estimates on AI trading desks' }),
    cand({ url: 'https://theverge.com/b', publisher: 'The Verge', domain: 'theverge.com', title: 'Coding agents from Anthropic now write enterprise software tests' }),
    cand({ url: 'https://techcrunch.com/c', title: 'Crypto token airdrop hype AI meme coins surge' }),
  ].map((c) => ({ ...c, vector: packVec(fakeVec(c.title)) }));
  const prefs = prefsOf([pref('Anthropic coding agents write enterprise software code')], [pref('Crypto token airdrop meme coins hype surge', -1)]);
  const r = selectNews(pool, prefs, now);
  assert.equal(r.top[0].url, 'https://theverge.com/b');
  assert.ok(r.top[0].reasons.some((x) => /좋아요 기사와/.test(x)));
  assert.ok(!r.top.some((t) => t.url === 'https://techcrunch.com/c'), '싫어요 기사와 거의 같은 기사 제외');
  assert.equal(r.excluded[0].url, 'https://techcrunch.com/c'); assert.match(r.excluded[0].reason, /비슷함/);
  assert.equal(r.method, 'embedding');
  const voted = selectNews(pool, prefs, now, { [normUrl('https://theverge.com/b')]: -1 });
  assert.ok(!voted.top.some((t) => t.url === 'https://theverge.com/b'), '직접 싫어요한 기사는 숨김');
});

test('좋아요가 없을 때는 중요도·종류·최신성으로 고르고, 국내·해외 할당 없이 한 매체는 2개까지', () => {
  const pool = Array.from({ length: 8 }, (_, i) => cand({ url: `https://techcrunch.com/${i}`, title: `OpenAI launches tool number ${i}`, at: now - i * H }))
    .concat([cand({ url: 'https://www.mckinsey.com/r', publisher: 'McKinsey', kind: 'report', domain: 'mckinsey.com', title: 'The state of AI 2026 survey report', at: now - 5 * 24 * H, source: 'mckinsey' })]);
  const r = selectNews(pool, prefsOf(), now);
  assert.equal(r.top.filter((t) => t.publisher === 'TechCrunch').length, 2);
  assert.ok(r.top.some((t) => t.category === 'report'), '5일 된 컨설팅 리포트도 추천에 오른다');
  assert.equal(r.method, 'keyword');
  const s = scoreCandidate({ ...pool[0], feat: new Set() }, prefsOf([{ ...pref('Google unveils Gemini'), url: 'z', domain: 'techcrunch.com' }]), now);
  assert.ok(s.parts.likePublisher > 5, '좋아요한 매체는 가산');
  const bad = scoreCandidate({ ...pool[0], feat: new Set() }, prefsOf([], [], new Map([['techcrunch.com', { up: 0, down: 3 }]])), now);
  assert.ok(bad.parts.source < -3, '싫어요가 많은 매체는 감점');
});

test('좋아요한 기사도 추천에 유지하고, 같은 성격의 다른 기사에 취향을 반영한다', () => {
  const liked = { ...pref('Anthropic launches Claude Haiku 5.5 fast model'), url: normUrl('https://www.aitimes.com/1'), domain: 'aitimes.com', created_at: new Date(now - H).toISOString() };
  const pool = [
    cand({ url: 'https://www.aitimes.com/1', publisher: 'AI타임스', domain: 'aitimes.com', title: 'Anthropic launches Claude Haiku 5.5 fast model' }),
    cand({ url: 'https://www.aitimes.com/2', publisher: 'AI타임스', domain: 'aitimes.com', title: 'Anthropic unveils Claude Dashboard for enterprise data' }),
    cand({ url: 'https://techcrunch.com/3', title: 'Bank earnings beat estimates on trading desks with AI' }),
  ].map((c) => ({ ...c, vector: packVec(fakeVec(c.title)) }));
  const r = selectNews(pool, prefsOf([liked]), now);
  assert.equal(r.top[0].url, 'https://www.aitimes.com/2', '같은 종류·회사·매체의 새 기사가 1위');
  assert.ok(r.top[0].reasons.some((x) => /좋아요한 Anthropic 소식/.test(x)));
  assert.ok(r.top.some((t) => t.url === 'https://www.aitimes.com/1'), '좋아요한 기사도 메인 선정 대상이다');
  const self = r.top.find((t) => t.url === 'https://www.aitimes.com/1');
  assert.deepEqual([self.parts.topic, self.parts.likeType, self.parts.likeEntity, self.parts.likePublisher], [5, 4, 5, 3.5], '독립적인 좋아요가 없으면 중립점수를 잃지 않는다');
  // 다른 매체가 쓴 같은 사건 기사도 가산점을 받지 않는다.
  const twin = scoreCandidate({ ...cand({ url: 'https://theverge.com/x', domain: 'theverge.com', title: 'Anthropic launches Claude Haiku 5.5 fast model' }), vec: liked.vec, feat: new Set() }, prefsOf([liked]), now);
  assert.equal(twin.aff.self, 1); assert.equal(twin.parts.likeEntity, 5);
});

test('좋아요의 무게는 시간이 갈수록 줄고 60일이 지나면 점수에 쓰지 않는다', () => {
  const c = { ...cand({ url: 'https://www.aitimes.com/9', domain: 'aitimes.com', title: 'OpenAI launches new agent' }), feat: new Set() };
  const at = (days) => ({ ...pref('Google unveils Gemini tool'), url: 'x', domain: 'aitimes.com', created_at: new Date(now - days * 24 * H).toISOString() });
  const fresh = { ...pref('OpenAI unveils GPT tool'), url: 'y', domain: 'theverge.com', created_at: new Date(now).toISOString() };
  const oldPub = (days) => scoreCandidate(c, prefsOf([at(days), fresh]), now).parts.likePublisher;
  assert.ok(oldPub(1) > oldPub(30), '오래된 좋아요의 매체 비중은 작아진다');
  assert.equal(scoreCandidate(c, prefsOf([at(90)]), now).parts.likePublisher, 3.5, '60일 지난 좋아요만 있으면 좋아요가 없는 것과 같다');
});

test('주제 점수도 좋아요 14일 반감기를 적용하고 자기 기사에는 중립점을 유지한다', () => {
  const c = { ...cand({ url: 'https://techcrunch.com/new', title: 'AI enterprise adoption' }), vec: unpackVec(packVec([1, 0])), feat: new Set() };
  const topic = (days) => scoreCandidate(c, prefsOf([{ title: 'AI workplace strategy', url: 'other', vec: unpackVec(packVec([0.7, Math.sqrt(0.51)])), domain: 'example.com', created_at: new Date(now - days * 24 * H).toISOString() }]), now).parts.topic;
  assert.ok(Math.abs(topic(14) - topic(0) / 2) < 1e-8);
  assert.ok(Math.abs(topic(28) - topic(0) / 4) < 1e-8);
  const self = scoreCandidate(c, prefsOf([{ title: c.title, url: c.key, vec: c.vec }]), now);
  assert.equal(self.parts.topic, 5);
});

test('고득점 기사에 좋아요를 눌러도 점수와 메인 순위를 낮추지 않는다', () => {
  const target = cand({ url: 'https://techcrunch.com/new-model', title: 'OpenAI launches new reasoning model', at: now, judge: { ai: true, importance: 4, type: 'launch' } });
  const pool = [target, ...Array.from({ length: 7 }, (_, i) => cand({ url: `https://example${i}.com/ai`, domain: `example${i}.com`, publisher: `Publisher ${i}`, title: 'AI industry news', judge: { ai: true, importance: 3, type: 'other' } }))];
  const before = selectNews(pool, prefsOf(), now);
  const liked = { ...pref(target.title), url: target.key, domain: target.domain };
  const after = selectNews(pool, prefsOf([liked]), now, { [target.key]: 1 });
  assert.equal(before.top[0].key, target.key);
  assert.equal(after.top[0].key, target.key);
  assert.equal(after.top[0].score, before.top[0].score);
  assert.equal(after.top[0].vote, 1);
});

test('나델라의 중대한 경고는 AI가 중요도 4·정책으로 판정해도 5·리더 발언으로 보호하고 좋아요와 무관하게 메인에 올린다', () => {
  const target = cand({ url: 'https://techcrunch.com/nadella', title: 'Microsoft’s Satya Nadella says AI models need an ‘emergency brake’', at: now - 4 * H, judge: { ai: true, importance: 4, type: 'policy' } });
  const likes = [{ ...pref('OpenAI launches new agent'), url: 'old-like', domain: 'aitimes.com' }];
  const pool = [target, ...Array.from({ length: 8 }, (_, i) => cand({ url: `https://example${i}.com/ai`, domain: `example${i}.com`, publisher: `Publisher ${i}`, title: 'OpenAI launches new agent', judge: { ai: true, importance: 4, type: 'launch' } }))];
  const selected = selectNews(pool, prefsOf(likes), now, { [target.key]: 1 });
  assert.equal(selected.top[0].key, target.key);
  assert.equal(selected.top[0].importance, 5);
  assert.equal(selected.top[0].category, 'leader');
  assert.ok(selected.top[0].reasons.includes('오늘의 주요 소식'));
  assert.equal(selected.top[0].parts.importance, 25);
  for (const title of ['Microsoft CEO Nadella discusses AI productivity', 'Microsoft CEO Nadella says car needs an emergency brake', 'AI models need an emergency brake']) {
    assert.equal(scoreCandidate({ ...cand({ title }), feat: new Set() }, prefsOf(), now).importance < 5, true, title);
  }
  assert.equal(scoreCandidate({ ...cand({ title: '마이크로소프트 나델라, AI 모델에 비상 정지 장치 필요 제언' }), feat: new Set() }, prefsOf(), now).importance, 5);
});

test('컨설팅 원문은 회사명이 제목에 없어도 분석 리포트이며 새 출처는 중복 등록하지 않는다', () => {
  for (const id of ['mckinsey', 'bain', 'bcg', 'deloitte', 'sectionai']) {
    const s = src(id);
    assert.equal(SOURCES.filter((x) => x.id === id).length, 1);
    assert.equal(ruleCategory({ title: 'Scaling AI across your organization', kind: s.kind, source: id, domain: s.domain }), 'report');
  }
  assert.equal(src('gemini').kind, 'official');
  assert.ok(isAi('Managing GenAI risks'));
});

test('큰 BCG 메뉴 뒤의 본문과 Deloitte 타일의 실제 제목을 읽는다', () => {
  const nav = '<a href="/menu">Navigation menu</a>'.repeat(15000);
  const bcg = parseListing(nav + '<main><a href="/publications/2026/ai-value"><h3>AI value creation strategy</h3></a></main>', src('bcg'));
  assert.equal(bcg.length, 1);
  assert.equal(bcg[0].title, 'AI value creation strategy');
  const deloitte = parseListing(nav + '<!-- Begin tile --><a href="/us/en/insights/topics/ai-risk.html"><!-- <h2>INSIGHTS</h2> --><p>Managing GenAI risks</p></a>', src('deloitte'));
  assert.equal(deloitte.length, 1);
  assert.equal(deloitte[0].title, 'Managing GenAI risks');
});

test('중요도 5 소식은 취향과 상관없이 추천에 먼저 오르고, 빅테크 CEO 발언은 리더 발언으로 분류된다', () => {
  const nadella = 'Microsoft CEO Nadella Calls for ‘Emergency Brake’ on Advanced AI';
  assert.equal(ruleCategory({ title: nadella, kind: 'news' }), 'leader');
  const likes = ['Anthropic launches Claude model', 'Google launches Gemini agent', 'OpenAI launches GPT tool']
    .map((t, i) => ({ ...pref(t), url: 'like' + i, domain: 'aitimes.com', created_at: new Date(now).toISOString() }));
  const pubs = [['AI타임스', 'aitimes.com'], ['The Verge', 'theverge.com'], ['TechCrunch', 'techcrunch.com'], ['인공지능신문', 'aitimes.kr']];
  const pool = Array.from({ length: 8 }, (_, i) => cand({ url: `https://${pubs[i % 4][1]}/${i}`, publisher: pubs[i % 4][0], domain: pubs[i % 4][1], title: `Anthropic launches Claude feature ${i}`, judge: { ai: true, importance: 4, type: 'launch' } }))
    .concat([cand({ url: 'https://www.bloomberg.com/n', publisher: 'Bloomberg', domain: 'bloomberg.com', title: nadella, at: now - 3 * H }),
      cand({ url: 'https://www.bloomberg.com/old', publisher: 'Bloomberg', domain: 'bloomberg.com', title: 'Old big AI deal', at: now - 50 * H, judge: { ai: true, importance: 5, type: 'deal' } })]);
  const r = selectNews(pool, prefsOf(likes), now);
  assert.equal(r.top[0].url, 'https://www.bloomberg.com/n');
  assert.equal(r.top[0].importance, 5); assert.equal(r.top[0].category, 'leader');
  assert.ok(r.top[0].reasons.includes('오늘의 주요 소식'));
  assert.ok(!r.top.some((t) => t.url === 'https://www.bloomberg.com/old'), '36시간 지난 중요 소식은 먼저 올리지 않는다');
});

test('같은 사건은 묶어 대표 기사 하나와 관련 보도로, 종류별 기간과 칼럼은 거른다', () => {
  const items = [
    { source: 'techcrunch', kind: 'news', publisher: 'TechCrunch', title: 'OpenAI launches GPT-6 reasoning model', url: 'https://techcrunch.com/1', summary: '', at: now - H, lang: 'en' },
    { source: 'openai', kind: 'official', publisher: 'OpenAI', title: 'Introducing GPT-6 reasoning model from OpenAI', url: 'https://openai.com/index/gpt-6', summary: '', at: now - 2 * H, lang: 'en' },
    { source: 'theverge', kind: 'news', publisher: 'The Verge', title: 'Old AI story', url: 'https://theverge.com/old', summary: '', at: now - 4 * 24 * H, lang: 'en' },
    { source: 'mckinsey', kind: 'report', publisher: 'McKinsey', title: 'Superagency in the workplace AI report', url: 'https://mckinsey.com/r', summary: '', at: now - 10 * 24 * H, lang: 'en' },
    { source: 'aitimes', kind: 'news', publisher: 'AI타임스', title: '[칼럼] AI 시대의 교육', url: 'https://aitimes.com/c', summary: '', at: now - H, lang: 'ko' },
  ];
  assert.equal(cluster(items.slice(0, 2)).length, 1);
  const c = candidates(items, now);
  assert.deepEqual(c.map((x) => x.publisher).sort(), ['McKinsey', 'OpenAI']);
  const gpt = c.find((x) => x.publisher === 'OpenAI');
  assert.equal(gpt.coverage, 2); assert.equal(gpt.related[0].publisher, 'TechCrunch', '공식 발표가 대표, 매체 보도는 관련 보도');
});

test('날짜 없는 목록 글: 출처를 처음 읽을 때 있던 글은 옛 글, 그 뒤 새로 보인 글은 처음 본 시각', () => {
  const first = [{ source: 'sectionai', url: 'https://sectionai.com/blog/a', undated: true, at: null }];
  const seen = applySeen(first, {}, now);
  assert.equal(first[0].at, now - 30 * 24 * H);
  const later = [{ source: 'sectionai', url: 'https://sectionai.com/blog/a', undated: true, at: null }, { source: 'sectionai', url: 'https://sectionai.com/blog/b', undated: true, at: null }];
  applySeen(later, seen, now + H);
  assert.equal(later[0].at, now - 30 * 24 * H); assert.equal(later[1].at, now + H);
  const edited = [{ source: 'techcrunch', url: 'https://techcrunch.com/x', at: now }];
  applySeen(edited, { 'techcrunch.com/x': now - 5 * H }, now);
  assert.equal(edited[0].at, now - 5 * H, '수정으로 늦어진 시각 대신 처음 본 시각');
});

test('번역: 연속 JSON 객체를 읽고, 빠진 제목은 전용 번역 모델로 보완하며 지난 번역을 재사용한다', async () => {
  assert.deepEqual(translationRows({ response: '{"i":0,"title_ko":"가 {괄호}"}\n{"i":1,"title_ko":"나"}' }).map((r) => r.i), [0, 1]);
  const calls = [];
  const env = { AI: { async run(model, input) { calls.push(model); if (model.includes('m2m100')) return { translated_text: '전용 ' + input.text }; return { response: '{"i":0,"title_ko":"첫 제목"}' }; } } };
  const list = [{ title: 'One', lang: 'en' }, { title: 'Two', lang: 'en' }, { title: 'One', lang: 'en' }, { title: 'Cached', lang: 'en' }, { title: '국내', lang: 'ko' }];
  await translate(env, list, new Map([['Cached', '저장된 번역']]));
  assert.deepEqual(list.map((t) => t.titleKo), ['첫 제목', '전용 Two', '첫 제목', '저장된 번역', '국내']);
});

function feeds({ extra = {} } = {}) {
  return async (url) => {
    const u = String(url);
    for (const [k, v] of Object.entries(extra)) if (u.includes(k)) return typeof v === 'function' ? v(u) : new Response(v);
    if (u.includes('techcrunch.com/category')) return new Response(rss([['Anthropic launches Claude coding agents for enterprise', 'https://techcrunch.com/2026/10/09/claude-agents', now - H],
      ['Bank earnings beat estimates on AI trading', 'https://techcrunch.com/2026/10/09/bank', now - 2 * H]]));
    if (u.includes('openai.com/news/rss')) return new Response(rss([['OpenAI gives developers free API tokens for GPT-6', 'https://openai.com/index/free-tokens', now - 3 * H]]));
    if (u.includes('theinformation')) return new Response(rss([['Crypto layoffs hit exchanges', 'https://www.theinformation.com/c', now - H]]));
    if (u.includes('anthropic.com/news') && !u.includes('/news/')) return new Response('<a href="/news/x-launch"><span>Oct 8, 2026</span><h3>Anthropic introduces Claude for Chrome</h3></a>');
    if (u.includes('anthropic.com/news/')) return new Response('<meta property="og:title" content="Claude for Chrome is here"><meta property="article:published_time" content="2026-10-08T15:00:00Z">');
    return new Response('nope', { status: 503 });
  };
}

test('수집부터 선정까지: 공식 발표·리포트·뉴스를 함께 고르고, 실패한 출처는 경고 대신 수집 상태에만 적는다', async (t) => {
  t.mock.method(globalThis, 'fetch', feeds());
  const env = { SESSIONS: kv(), AI: fakeAi(), DB: d1() };
  const snap = await buildNews(env, now);
  const titles = snap.top.map((x) => x.title);
  assert.ok(titles.includes('OpenAI gives developers free API tokens for GPT-6'));
  assert.ok(titles.includes('Claude for Chrome is here'), '목록 화면 글은 기사 페이지에서 제목을 보완');
  assert.ok(!titles.some((x) => /Crypto/.test(x)), 'AI 와 무관한 글 제외');
  assert.equal(snap.top.find((x) => /free API tokens/.test(x.title)).category, 'free');
  assert.ok(snap.top.every((x) => x.titleKo), '영문 제목 번역');
  assert.deepEqual(snap.warnings, [], 'Google·출처 실패 경고를 띄우지 않는다');
  assert.equal(snap.sources.find((s) => s.id === 'bloomberg').ok, false);
  assert.ok(!JSON.stringify(snap).includes('news.google.com'));
  assert.ok(env.AI.calls.includes('@cf/baai/bge-m3'));
  const pool = JSON.parse(env.SESSIONS.values.get('news:pool'));
  assert.ok(pool.items.every((c) => typeof c.vector === 'string'));
  // 다음 수집은 지난 임베딩·판정을 재사용한다.
  env.AI.calls.length = 0;
  await buildNews(env, now + H);
  assert.ok(!env.AI.calls.includes('@cf/baai/bge-m3'), '새 후보가 없으면 임베딩을 다시 부르지 않는다');
});

test('목록 보완은 출처별로 나눠 5개만 읽고 새 컨설팅 글의 날짜와 분류를 복원한다', async (t) => {
  const opened = [];
  const titles = { anthropic: 'Claude launches new coding assistant', bcg: 'AI manufacturing workforce productivity survey', deloitte: 'GenAI governance cyber risk controls report', sectionai: 'Marketing customer segmentation with artificial intelligence' };
  const listing = (s) => (s.mainOnly ? '<main>' : s.listingStart || '') + Array.from({ length: 6 }, (_, i) => `<a href="${s.prefix}ai-strategy-${i}"><h3>${titles[s.id]} ${i}</h3></a>`).join('');
  t.mock.method(globalThis, 'fetch', async (url) => {
    const s = SOURCES.find((s) => s.url === String(url));
    if (s) return new Response(s.format === 'html' ? listing(s) : '<rss></rss>');
    opened.push(String(url));
    const articleSource = SOURCES.find((s) => s.domain && String(url).includes(s.domain));
    return new Response(`<meta property="og:title" content="${titles[articleSource.id]}"><meta property="article:published_time" content="${new Date(now - H).toISOString()}">`);
  });
  const snap = await buildNews({ SESSIONS: kv(), DB: d1() }, now);
  assert.equal(opened.length, 5);
  for (const id of ['anthropic', 'bcg', 'deloitte', 'sectionai']) {
    assert.ok(opened.some((u) => u.includes(src(id).domain)), `${id}도 페이지 보완 기회를 받는다`);
  }
  const reports = [...snap.top, ...snap.more].filter((x) => x.kind === 'report');
  assert.ok(reports.some((x) => x.publisher === 'BCG' && x.category === 'report'));
  assert.ok(reports.some((x) => x.publisher === 'Deloitte' && x.category === 'report'));
  assert.ok(SOURCES.length + opened.length + 8 <= 40, '학습 출처 8개를 더해도 수집 호출 예산 이내');
});

test('좋아하는 기사 주소 등록: 페이지를 읽어 학습하고 처음 보는 사이트는 RSS 출처로 배우며 다음 수집에 쓴다', async (t) => {
  t.mock.method(globalThis, 'fetch', feeds({ extra: {
    'example-ai.com/feed': rss([['Example AI agents platform launch', 'https://example-ai.com/posts/agents', now - H], ['Example AI second post', 'https://example-ai.com/posts/2', now - 2 * H], ['Example AI third post', 'https://example-ai.com/posts/3', now - 3 * H]]),
    'example-ai.com/posts/1': '<meta property="og:title" content="Agents in the enterprise"><meta property="og:site_name" content="Example AI"><link rel="alternate" type="application/rss+xml" href="https://example-ai.com/feed">',
    'techcrunch.com/2026/10/01/x': '<meta property="og:title" content="Claude coding agents for enterprise teams">',
    'blocked.com': () => new Response('no', { status: 403 }),
  } }));
  const env = { SESSIONS: kv(), AI: fakeAi(), DB: d1() };
  const r = await submitLikes(env, 7, 'https://example-ai.com/posts/1\nhttps://techcrunch.com/2026/10/01/x\nhttps://blocked.com/ai-agents-report', now);
  assert.deepEqual(r.added.map((a) => a.ok), [true, true, false]);
  assert.equal(r.added[2].title, 'ai agents report', '막힌 페이지는 주소로 제목을 짐작');
  assert.deepEqual(r.learned.map((s) => [s.domain, s.format]), [['example-ai.com', 'rss']], '기본 출처(TechCrunch)는 다시 배우지 않는다');
  assert.equal(env.DB.feedback.length, 3); assert.equal(env.DB.feedback[0].user_id, 7); assert.ok(env.DB.feedback[0].vector);
  const prefs = await loadPrefs(env);
  assert.equal(prefs.likes.length, 3);
  const snap = await buildNews(env, now);
  assert.ok(snap.sources.some((s) => s.learned && s.ok && s.count === 3));
  assert.ok([...snap.top, ...snap.more].some((c) => c.publisher === 'Example AI'), '배운 출처의 기사가 후보에 오른다');
  assert.equal(snap.top[0].title, 'Anthropic launches Claude coding agents for enterprise', '등록한 기사와 가장 닮은 기사가 1위');
  const list = await listPrefs(env);
  assert.equal(list.items.length, 3); assert.equal(list.sources[0].domain, 'example-ai.com'); assert.ok(!JSON.stringify(list).includes('vector'));
  await assert.rejects(submitLikes(env, 7, 'not a url', now), /기사 주소/);
  await assert.rejects(submitLikes(env, 7, Array.from({ length: 11 }, (_, i) => `https://a.com/${i}`).join('\n'), now), /10개/);
});

test('👎 은 바로 숨기고, 새로고침하면 수집 없이 점수만 다시 매기며 수동 재수집은 10분 간격', async (t) => {
  let calls = 0;
  const handler = feeds();
  t.mock.method(globalThis, 'fetch', async (u) => { calls++; return handler(u); });
  const env = { SESSIONS: kv(), AI: fakeAi(), DB: d1() };
  const first = await newsFeed(env, { now });
  const target = first.top[0];
  await voteNews(env, 1, { url: target.url, vote: -1 }, now + 60000);
  assert.equal(env.DB.feedback[0].vote, -1); assert.ok(env.DB.feedback[0].vector, '후보 묶음의 임베딩을 재사용');
  const before = calls;
  const hidden = await newsFeed(env, { now: now + 2 * 60000 });
  assert.ok(!hidden.top.some((x) => x.key === target.key), '저장본에서도 바로 숨긴다');
  const rescored = await newsFeed(env, { now: now + 3 * 60000, refresh: true });
  assert.equal(calls, before, '평가가 바뀐 새로고침은 다시 수집하지 않는다');
  assert.ok(rescored.excluded.some((x) => x.url === target.url));
  await newsFeed(env, { now: now + 5 * 60000, refresh: true });
  assert.equal(calls, before, '10분 안의 수동 갱신은 저장본');
  await newsFeed(env, { now: now + 11 * 60000, refresh: true });
  assert.ok(calls > before);
  await voteNews(env, 1, { url: target.url, vote: 0 }, now + 12 * 60000);
  assert.equal(env.DB.feedback.length, 0, '평가 취소');
  await assert.rejects(voteNews(env, 1, { url: 'javascript:1', vote: 1 }), /주소/);
  const waits = [];
  const stale = await newsFeed(env, { now: now + 3 * H, ctx: { waitUntil: (p) => waits.push(p) } });
  assert.ok(stale.builtAt); assert.equal(waits.length, 1, '오래된 저장본은 바로 주고 뒤에서 갱신');
  await Promise.all(waits);
});

test('임베딩·D1 이 없어도 키워드 비교로 동작하고, 모든 출처가 실패하면 지난 화면을 지킨다', async (t) => {
  t.mock.method(globalThis, 'fetch', feeds());
  const env = { SESSIONS: kv(), AI: fakeAi({ embedFail: true }) };
  const snap = await buildNews(env, now);
  assert.ok(snap.top.length > 0); assert.equal(snap.learning.method, 'keyword'); assert.equal(snap.learning.ready, false);
  t.mock.method(globalThis, 'fetch', async () => new Response('x', { status: 500 }));
  const again = await buildNews(env, now + H);
  assert.equal(again.builtAt, snap.builtAt);
  assert.equal(applyVotes(snap, { [snap.top[0].key]: -1 }).top[0].key, snap.top[1].key);
  assert.equal(learnedSource({ domain: 'x.com', name: 'X', feed_url: 'https://x.com', format: 'html', kind: 'news', link_prefix: '/blog/' }).format, 'html');
  assert.equal(typeof rescoreNews, 'function');
});

test('카드 HTML은 이스케이프하고 스크립트 링크를 만들지 않으며 평가 단추를 단다', () => {
  const html = topCard({ rank: 1, key: 'k', title: '<img src=x onerror=alert(1)>', titleKo: null, url: 'javascript:alert(1)', publisher: '<b>', kind: 'official', at: new Date(now).toISOString(),
    paywall: true, reasons: ['<i>x</i>'], related: [{ publisher: 'R', title: 't', url: 'javascript:1' }], vote: 1, score: 67.4 });
  assert.ok(!html.includes('<img')); assert.ok(!html.includes('<i>x')); assert.ok(!html.includes('href="javascript:'));
  assert.ok(html.includes('공식 발표') && html.includes('유료') && html.includes('data-vote="-1"') && html.includes('aria-pressed="true"'));
  assert.match(html, /점수 67\.4/);
  const row = moreRow({ key: 'k', title: 'T', url: 'https://techcrunch.com/a', publisher: 'TechCrunch', kind: 'report', categoryLabel: '분석 리포트', at: new Date(now).toISOString(), score: 50, vote: 0 });
  assert.ok(row.includes('href="https://techcrunch.com/a"') && row.includes('noopener') && row.includes('리포트·인사이트'));
  assert.match(builtLine({ builtAt: new Date(now).toISOString(), learning: { likes: 3, dislikes: 1, learnedSources: 2, method: 'embedding' } }), /좋아요 3 · 싫어요 1 · 학습한 출처 2 · AI 임베딩/);
  assert.ok(warningHtml({ warnings: ['<b>'] }).includes('&lt;b&gt;')); assert.equal(warningHtml({ warnings: [] }), '');
  assert.ok(!warningHtml({ warnings: [] }).includes('데이터 경고'));
  assert.match(topListsHtml({ top: [] }), /찾지 못했습니다/);
  assert.equal(sourcesLine({ sources: [{ name: 'A', ok: true, count: 2 }, { name: 'B', ok: false, learned: true }] }), 'A 2건 · B(학습) 실패');
  assert.equal(safeNewsUrl('javascript:1'), '');
});

test('메뉴: AI NEWS 는 개인서비스에', () => {
  const news = SERVICES.find((s) => s.key === 'news');
  assert.equal(news.group, 'personal'); assert.equal(news.route, '#/news');
});

test('AI NEWS API(조회·등록·평가·학습 현황)는 로그인 없이 열리지 않는다', async () => {
  const env = { SESSION_SECRET: 'test-secret-not-for-production', SESSIONS: kv(), DB: { prepare() { return { bind() { return this; }, async first() { return null; }, async all() { return { results: [] }; }, async run() {} }; } } };
  for (const [path, method] of [['/api/news', 'GET'], ['/api/news/likes', 'POST'], ['/api/news/feedback', 'POST'], ['/api/news/preferences', 'GET'], ['/api/news/preferences/1', 'DELETE'], ['/api/news/sources/a.com', 'DELETE']]) {
    const res = await worker.fetch(new Request('https://japis.example' + path, { method, ...(method === 'POST' ? { body: '{}' } : {}) }), env, {});
    assert.equal(res.status, 401, path);
  }
});

test('매시 예약 작업은 뉴스만 갱신하고 하루 정리 작업과 섞지 않는다', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('x', { status: 500 }));
  const waits = [];
  await worker.scheduled({ cron: '3 * * * *' }, { SESSIONS: kv() }, { waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  assert.equal(waits.length, 1);
});
