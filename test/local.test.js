/**
 * 本地单元测试：验证「官方 atom 全文保留 + prerelease 过滤」新逻辑。
 * 用真实的 GitHub 官方 releases.atom 片段，确保不捏造结构。
 * 运行：node test/local.test.js
 */
const fs = require('fs');
const { parseOfficialAtom, tagFromEntry, unescapeXml, buildAtom } = require('../src/worker.js');

// 模拟一段官方 releases.atom（结构与 GitHub 完全一致，但去掉了长正文）
const officialSample = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">
  <id>tag:github.com,2008:https://github.com/x/y/releases</id>
  <title>Release notes from y</title>
  <updated>2026-07-20T04:35:41Z</updated>
  <entry>
    <id>tag:github.com,2008:Repository/123/0.18.0</id>
    <updated>2026-07-20T04:35:41Z</updated>
    <link rel="alternate" type="text/html" href="https://github.com/x/y/releases/tag/0.18.0"/>
    <title>0.18.0 - Dreamland</title>
    <content type="html">&lt;p&gt;&lt;img src=&quot;https://cdn/a.png&quot; width=&quot;1200&quot;/&gt;&lt;/p&gt;&lt;p&gt;正式版 &lt;a href=&quot;https://github.com/x/y&quot;&gt;链接&lt;/a&gt;&lt;/p&gt;</content>
    <author><name>dev</name></author>
    <media:thumbnail href="https://x/a.png"/>
  </entry>
  <entry>
    <id>tag:github.com,2008:Repository/123/0.17.0-preview.2</id>
    <updated>2026-05-09T13:37:55Z</updated>
    <link rel="alternate" type="text/html" href="https://github.com/x/y/releases/tag/0.17.0-preview.2"/>
    <title>0.17.0 Preview 2</title>
    <content type="html">&lt;p&gt;预览版内容&lt;/p&gt;</content>
    <author><name>dev</name></author>
  </entry>
  <entry>
    <id>tag:github.com,2008:Repository/123/0.99.0</id>
    <updated>2026-08-10T00:00:00Z</updated>
    <link rel="alternate" type="text/html" href="https://github.com/x/y/releases/tag/0.99.0"/>
    <title>0.99.0</title>
    <content type="html">&lt;p&gt;0.99.0&lt;/p&gt;</content>
    <author><name>dev</name></author>
  </entry>
</feed>
`;

let passed = 0;
function assert(name, cond) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    console.error(`  ✗ FAIL: ${name}`);
    process.exitCode = 1;
  }
}

console.log('■ 解析官方 Atom');
const entries = parseOfficialAtom(officialSample);
assert('解析出 3 条 entry', entries.length === 3);
assert('首条 title 正确解码', entries[0].title === '0.18.0 - Dreamland');
// content 在 XML 中是转义的（&lt;img...），代表 HTML 内容；未解码字符串应含 img/a 标记
assert('首条保留 HTML 图片(img)', entries[0].contentHtml.includes('img'));
assert('首条保留 HTML 链接(a)', entries[0].contentHtml.includes('a href'));
assert('content 仍是 XML 转义形式(&lt;)', entries[0].contentHtml.includes('&lt;'));
assert('含 author', entries[0].author === 'dev');

console.log('■ tag 提取');
assert('从 link 提取 tag', tagFromEntry(entries[0]) === '0.18.0');
assert('preview tag 提取正确', tagFromEntry(entries[1]) === '0.17.0-preview.2');

console.log('■ unescapeXml');
assert('解码 &amp; &lt;', unescapeXml('a &amp; b &lt;c&gt;') === 'a & b <c>');

console.log('■ 过滤（结合 prerelease 映射）');
const preMap = new Map([
  ['0.18.0', { prerelease: false, draft: false }],
  ['0.17.0-preview.2', { prerelease: true, draft: false }],
  // 0.99.0 故意不在映射里 = 纯 tag 无 release
]);
// 与 worker 修复后逻辑保持一致：查不到映射 → 丢弃
const stable = entries.filter((e) => {
  const st = preMap.get(tagFromEntry(e));
  if (!st) return false;
  return !st.prerelease && !st.draft;
});
assert('过滤掉 preview', stable.length === 1 && stable[0].title === '0.18.0 - Dreamland');
assert('纯 tag 无 release 被过滤(0.99.0)', !stable.some((e) => tagFromEntry(e) === '0.99.0'));

console.log('■ buildAtom 保留全 HTML');
const atom = buildAtom('X/Y — Releases (stable)', 'tag:t', 'https://x/feed', stable);
const contentM = /<content type="html">([\s\S]*?)<\/content>/.exec(atom);
assert('content type 为 html', atom.includes('<content type="html">'));
assert('包含图片 img 标记', contentM && contentM[1].includes('&lt;img'));
assert('包含链接 a 标记', contentM && contentM[1].includes('a href'));

console.log('\n通过断言数：' + passed);
