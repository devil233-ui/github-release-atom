/**
 * github-release-atom — Cloudflare Worker
 *
 * 订阅 GitHub 仓库的 Release，精确过滤掉 prerelease/draft，输出标准 Atom feed。
 *
 * 设计要点（重要）：
 *  - 正文直接使用 GitHub 官方 releases.atom 里「已渲染好的完整 HTML」，
 *    因此图片、链接、排版和官方源完全一致，不会丢内容。
 *  - prerelease/draft 过滤无法靠官方 atom 判断，因此同时调用 REST API
 *    /repos/{owner}/{repo}/releases 拿到 tag_name 的 prerelease/draft 标记，
 *    用 tag 名把两者对应上，过滤掉预发布。
 *
 * 用法：
 *   /?repo=owner/repo
 *   /?repo=a/b&repo=c/d            多仓库合成一个 feed
 * 可选：pre=1 同时包含 prerelease（对照用）；per=<n> 每仓最多条数（默认20，最大50）
 */

const GITHUB_API = 'https://api.github.com';
const DEFAULT_PER = 20;
const MAX_PER = 50;
const CACHE_TTL_SEC = 5 * 60;

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function rfc3339(iso) {
  if (!iso) return new Date().toISOString();
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

/** 从官方 releases.atom 的 XML 里解析 entry 数组 */
function parseOfficialAtom(xml) {
  const entries = [];
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
  let m;
  while ((m = entryRe.exec(xml))) {
    const body = m[1];
    const id = /<id[^>]*>([\s\S]*?)<\/id>/.exec(body);
    const title = /<title[^>]*>([\s\S]*?)<\/title>/.exec(body);
    const updated = /<updated[^>]*>([\s\S]*?)<\/updated>/.exec(body);
    const link = /<link[^>]*href="([^"]*)"[^>]*rel="alternate"[^>]*>/.exec(body) || /<link[^>]*rel="alternate"[^>]*href="([^"]*)"[^>]*>/.exec(body);
    const content = /<content[^>]*type="html"[^>]*>([\s\S]*?)<\/content>/.exec(body);
    // entry 里可能带有嵌套的 content（Atom 允许）。取完整 content 原文。
    const author = /<author>\s*<name>([\s\S]*?)<\/name>/.exec(body);
    entries.push({
      id: id ? id[1].trim() : '',
      title: title ? unescapeXml(title[1]) : '',
      updated: updated ? updated[1].trim() : '',
      link: link ? unescapeXml(link[1]) : '',
      contentHtml: content ? content[1] : '',
      author: author ? author[1].trim() : '',
    });
  }
  return entries;
}

function unescapeXml(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** 从 release tag 链接或 atom id 里提取 tag 名 */
function tagFromEntry(e) {
  const m = /releases\/tag\/([^\/?#]+)/.exec(e.link);
  if (m) return decodeURIComponent(m[1]);
  // id 形如 tag:github.com,2008:Repository/123456/0.18.0
  const im = /\/[^\/]+\/([^\/]+)$/.exec(e.id);
  return im ? im[1] : '';
}

/** 拉取官方 releases.atom */
async function fetchOfficialAtom(repo, token) {
  const url = `https://github.com/${repo}/releases.atom`;
  const headers = { 'User-Agent': 'github-release-atom-worker' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const resp = await fetch(url, { headers, signal: ctrl.signal });
    if (!resp.ok) throw new Error(`官方 Atom 返回 ${resp.status} (${repo})`);
    return await resp.text();
  } finally {
    clearTimeout(timer);
  }
}

/** 拉取 REST API 拿到 tag -> prerelease/draft 映射（一路翻页） */
async function fetchPrereleaseMap(repo, token) {
  const ret = new Map();
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'github-release-atom-worker',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  // 官方 releases.atom 只返回最新 10 条，REST 第一页（100 条）必然覆盖，
  // 因此只拉 1 页即可，既省限流又降延迟。
  for (let page = 1; page <= 1; page++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      const resp = await fetch(`${GITHUB_API}/repos/${repo}/releases?per_page=100&page=${page}`, {
        headers,
        signal: ctrl.signal,
      });
      if (!resp.ok) throw new Error(`GitHub API ${resp.status} (${repo})`);
      const batch = await resp.json();
      if (!Array.isArray(batch)) break;
      for (const r of batch) ret.set(r.tag_name, { prerelease: !!r.prerelease, draft: !!r.draft });
      if (batch.length < 100) break;
      const link = resp.headers.get('link') || '';
      if (!link.includes('rel="next"')) break;
    } finally {
      clearTimeout(timer);
    }
  }
  return ret;
}

function buildAtom(feedTitleTxt, feedId, feedLink, entries) {
  const updated = entries.length ? entries[0].updated : new Date().toISOString();
  const body = entries
    .map((e) => {
      return `  <entry>
    <title>${esc(e.title)}</title>
    <id>${esc(e.id)}</id>
    <updated>${rfc3339(e.updated)}</updated>
    <published>${rfc3339(e.updated)}</published>
    <link rel="alternate" type="text/html" href="${esc(e.link)}"/>
    <content type="html">${e.contentHtml}</content>
    <author><name>${esc(e.author)}</name></author>
  </entry>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${esc(feedTitleTxt)}</title>
  <id>${esc(feedId)}</id>
  <updated>${updated}</updated>
  <link rel="self" type="application/atom+xml" href="${esc(feedLink)}"/>
${body}
</feed>
`;
}

async function handleRequest(request, env) {
  const url = new URL(request.url);
  const repos = url.searchParams.getAll('repo');
  const includePre = url.searchParams.get('pre') === '1';
  const perRaw = parseInt(url.searchParams.get('per') || '', 10);
  const per = Number.isFinite(perRaw) ? Math.min(Math.max(perRaw, 1), MAX_PER) : DEFAULT_PER;
  const token = env?.GITHUB_TOKEN;

  if (repos.length === 0) {
    return new Response(
      'github-release-atom worker 运行中。\n\n订阅请在 URL 上用 ?repo=owner/repo 指定仓库，例如：\n' +
        '  /?repo=Scighost/Starward\n' +
        '多仓库用多个 &repo= 叠加。加 pre=1 可临时包含 prerelease 用于对照。\n',
      { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
    );
  }

  const cacheKey = new Request(url.href, { method: 'GET' });
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) {
    return new Response(cached.body, {
      status: cached.status,
      headers: {
        'Content-Type': 'application/atom+xml; charset=utf-8',
        'Cache-Control': `public, max-age=${CACHE_TTL_SEC}`,
        'X-GHR-Filter': includePre ? 'all' : 'stable-only',
      },
    });
  }

  let feed;
  try {
    const merged = [];
    for (const repo of repos) {
      const [atomXml, preMap] = await Promise.all([
        fetchOfficialAtom(repo, token),
        fetchPrereleaseMap(repo, token),
      ]);
      let entries = parseOfficialAtom(atomXml);
      if (!includePre) {
        entries = entries.filter((e) => {
          const st = preMap.get(tagFromEntry(e));
          // tag 不在 REST 映射里 = 纯 tag 无 release（如 0.18.1）→ 丢弃；
          // 有 release 但标记为 prerelease/draft → 丢弃。
          if (!st) return false;
          return !st.prerelease && !st.draft;
        });
      }
      merged.push(...entries.slice(0, per));
    }
    // 多仓库按 updated 汇总排序
    merged.sort((a, b) => new Date(b.updated) - new Date(a.updated));
    const cap = per * Math.max(repos.length, 1);
    const feedTitle = `${repos.join(', ')} — Releases${includePre ? '' : ' (stable)'}`;
    const feedId = `tag:github.com,2008:releases/${repos.join('+')}/${includePre ? 'all' : 'stable'}`;
    const feedLink = url.origin + url.pathname + url.search;
    feed = buildAtom(feedTitle, feedId, feedLink, merged.slice(0, cap));
  } catch (e) {
    return new Response(`生成失败：${esc(e.message)}`, {
      status: 502,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  const resp = new Response(feed, {
    status: 200,
    headers: {
      'Content-Type': 'application/atom+xml; charset=utf-8',
      'Cache-Control': `public, max-age=${CACHE_TTL_SEC}`,
      'ETag': `"${hash(feed)}"`,
    },
  });

  await cache.put(cacheKey, resp.clone());
  return resp;
}

function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

if (typeof addEventListener !== 'undefined') {
  addEventListener('fetch', (event) => {
    event.respondWith(handleRequest(event.request, event.env));
  });
}

// 供本地单元测试复用内部纯函数；同一份源码两种运行方式。
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { esc, rfc3339, buildAtom, parseOfficialAtom, tagFromEntry, unescapeXml };
}
