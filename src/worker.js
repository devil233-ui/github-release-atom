/**
 * github-release-atom — Cloudflare Worker
 *
 * 从 GitHub Releases API 拉取仓库发行版本，精确过滤掉 prerelease 与 draft，
 * 输出标准 Atom 1.0 feed，供任意 RSS/Atom 阅读器订阅（Feedbro、TTRSS、NetNewsWire 等）。
 *
 * 用法（订阅 URL）：
 *   https://<worker>.workers.dev/?repo=Scighost/Starward
 *   https://<worker>.workers.dev/?repo=Scighost/Starward&repo=other/repo   # 多仓库合成一个 feed
 *
 * 可选参数：
 *   pre=1    同时输出 prerelease（默认关闭，便于对照验证过滤效果）
 *   per=<n>  每个仓库最多取多少条（默认 20，最大 50）
 */

const GITHUB_API = 'https://api.github.com';
const DEFAULT_PER = 20;
const MAX_PER = 50;
// GitHub 未认证限流 60 req/h/IP；用 CF Cache 缓存 feed，锁定 Cache-Control 周期内命中缓存、不进 API。
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

// GitHub release body 是 Markdown 文本；转成 <pre> 保留原文可读，且无需 markdown 渲染依赖。
// 关键：只做一次 XML 转义，避免双重转义。
function mdToHtml(md) {
  const raw = String(md || '');
  const cleaned = raw
    .split(/\n/)
    .map((l) => l.replace(/^\s*/, ''))
    .filter(Boolean)
    .join('\n');
  return `<pre style="white-space:pre-wrap;font-family:inherit">${esc(cleaned)}</pre>`;
}

function buildAtom(feedTitleTxt, feedId, feedLink, releases) {
  const updated = releases.length ? rfc3339(releases[0].published_at) : new Date().toISOString();

  const entries = releases
    .map((r) => {
      const title = r.name || r.tag_name;
      const id = `tag:github.com,2008:release/${r.id}`;
      const ts = rfc3339(r.published_at);
      const link = r.html_url;
      const content = mdToHtml(r.body);
      const author = r.author ? r.author.login : '';
      return `  <entry>
    <title>${esc(title)}</title>
    <id>${id}</id>
    <updated>${ts}</updated>
    <published>${ts}</published>
    <link rel="alternate" type="text/html" href="${esc(link)}"/>
    <content type="xshtml"><div xmlns="http://www.w3.org/1999/xhtml">${content}</div></content>
    <author><name>${esc(author)}</name></author>
  </entry>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${esc(feedTitleTxt)}</title>
  <id>${esc(feedId)}</id>
  <updated>${updated}</updated>
  <link rel="self" type="application/atom+xml" href="${esc(feedLink)}"/>
${entries}
</feed>
`;
}

async function fetchLatestReleases(repo, per, includePrerelease, token) {
  const origin = `${GITHUB_API}/repos/${repo}/releases?per_page=100`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const resp = await fetch(origin, {
      signal: controller.signal,
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'github-release-atom-worker',
        // 可选：设置环境变量 GITHUB_TOKEN（wrangler secret put GITHUB_TOKEN）可把限流提升到 5000 req/h。
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!resp.ok) throw new Error(`GitHub API 返回 ${resp.status} (${repo})`);
    const all = await resp.json();
    if (!Array.isArray(all)) throw new Error(`GitHub API 响应异常 (${repo})`);
    const filtered = includePrerelease ? all : all.filter((r) => !r.prerelease && !r.draft);
    return filtered.slice(0, per);
  } finally {
    clearTimeout(timer);
  }
}

async function handleRequest(request, env) {
  const url = new URL(request.url);
  const repos = url.searchParams.getAll('repo');
  const includePre = url.searchParams.get('pre') === '1';
  const perRaw = parseInt(url.searchParams.get('per') || '', 10);
  const per = Number.isFinite(perRaw) ? Math.min(Math.max(perRaw, 1), MAX_PER) : DEFAULT_PER;

  if (repos.length === 0) {
    return new Response(
      'github-release-atom worker 运行中。\n\n订阅请在 URL 上用 ?repo=owner/repo 指定仓库，例如：\n' +
        '  /?repo=Scighost/Starward\n' +
        '多仓库用多个 &repo= 叠加。加 pre=1 可临时包含 prerelease 用于对照。\n',
      {
        status: 200,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      },
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
    const all = [];
    for (const repo of repos) {
      const rels = await fetchLatestReleases(repo, per, includePre, env?.GITHUB_TOKEN);
      all.push(...rels);
    }
    // 多仓库按发布时间汇总，新→旧
    all.sort((a, b) => new Date(b.published_at) - new Date(a.published_at));
    const cap = per * Math.max(repos.length, 1);
    const feedTitle = `${repos.join(', ')} — Releases${includePre ? '' : ' (stable)'}`;
    const feedId = `tag:github.com,2008:releases/${repos.join('+')}/${includePre ? 'all' : 'stable'}`;
    const feedLink = url.origin + url.pathname + url.search;
    feed = buildAtom(feedTitle, feedId, feedLink, all.slice(0, cap));
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
  module.exports = { esc, rfc3339, mdToHtml, buildAtom };
}
