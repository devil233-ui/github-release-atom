/**
 * 本地单元测试：验证 prerelease/draft 过滤 + Atom 生成。
 * 直接 require 真实的 worker.js（其内部纯函数已导出）。
 * 运行：node test/local.test.js
 */
const { esc, rfc3339, mdToHtml, buildAtom } = require('../src/worker.js');

function mockRelease(id, tag, prerelease, draft, published) {
  return {
    id,
    tag_name: tag,
    name: tag,
    prerelease,
    draft,
    published_at: published,
    html_url: `https://github.com/x/y/releases/tag/${tag}`,
    body: '# 标题\n- 列表项 A\n- 列表项 B',
    author: { login: 'tester' },
  };
}

const releases = [
  mockRelease(1, '0.18.0', false, false, '2026-07-20T04:35:41Z'),
  mockRelease(2, '0.17.0-preview.2', true, false, '2026-05-09T13:37:55Z'),
  mockRelease(3, '0.16.3', false, false, '2026-03-03T04:58:45Z'),
  mockRelease(4, '0.16.0-draft', false, true, '2026-01-01T00:00:00Z'),
  mockRelease(5, '0.16.0', false, false, '2025-11-14T15:43:24Z'),
];

// 带 XML 特殊字符的 body，用于验证「只转义一次，不双重转义」
const specialBody = '# 标题 <script>alert(1)</script> & 2 < 3 > 1';

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

console.log('■ 过滤逻辑（stable-only）');
const stable = releases.filter((r) => !r.prerelease && !r.draft);
assert('去掉 prerelease(0.17.0-preview.2)', !stable.some((r) => r.id === 2));
assert('去掉 draft(0.16.0-draft)', !stable.some((r) => r.id === 4));
assert('留下 0.18.0 / 0.16.3 / 0.16.0', stable.length === 3);

console.log('■ 过滤逻辑（include prerelease）');
const allIncl = releases.filter((r) => !r.draft);
assert('仍排除 draft', !allIncl.some((r) => r.id === 4));
assert('包含 prerelease', allIncl.some((r) => r.id === 2));

console.log('■ Atom 生成');
const atom = buildAtom('Scighost/Starward — Releases (stable)', 'tag:github.com,2008:test', 'https://ex/feed', stable);
assert('有 <feed> 根节点', atom.includes('<feed xmlns="http://www.w3.org/2005/Atom">'));
assert('含 0.16.0 标题', atom.includes('<title>0.16.0</title>'));
assert('不含 preview tag', !atom.includes('0.17.0-preview.2'));
assert('不含 draft tag', !atom.includes('0.16.0-draft'));
assert('含 self 链接', atom.includes('https://ex/feed'));
assert('content 使用 xshtml', atom.includes('type="xshtml"'));

console.log('■ 转义（只一次，不双重转义）');
const md = mdToHtml(specialBody);
assert('把 < 转成 &lt;', md.includes('&lt;'));
assert('把 & 转成 &amp;', md.includes('&amp;'));
assert('不出现双重转义 &amp;lt;', !md.includes('&amp;lt;'));
assert('不出现未转义的 <script>', !md.includes('<script>'));

// 用真实本地文件写一个示例 feed，方便你直接拖进阅读器或检查
const fs = require('fs');
const path = require('path');
const sample = buildAtom(
  'Scighost/Starward — Releases (stable)',
  'tag:github.com,2008:sample',
  'https://example/sample',
  releases.filter((r) => !r.prerelease && !r.draft),
);
fs.writeFileSync(path.join(__dirname, 'sample.atom'), sample);
console.log('\n已生成本地示例 feed：test/sample.atom');
console.log('通过断言数：' + passed);
