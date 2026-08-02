# GitHub Release → Atom（过滤 prerelease）

把 GitHub 仓库的 **Releases** 拉下来，精确过滤掉 prerelease（预发布）和 draft（草稿），
生成一个 **标准 Atom feed**，供任意 RSS/Atom 阅读器订阅（Feedbro、Tiny Tiny RSS、NetNewsWire 等均可）。

> ✅ **已线上部署**（Cloudflare Workers），可直接订阅。

## 订阅地址（直接可用）

```
https://github-release-atom.devil233.workers.dev
```

多仓库合成一个 feed（追加 `&repo=` 即可）：

```
https://github-release-atom.devil233.workers.dev/?repo=Scighost/Starward&repo=其他作者/其他仓库
```

- 默认过滤 prerelease + draft，只留正式版
- 加 `&pre=1` 可临时查看包含预发布的版本（对照用）
- 源码仓库：<https://github.com/devil233-ui/github-release-atom>

## 为什么需要它

GitHub 官方的 `releases.atom` 源**没有** `prerelease` 标记字段，阅读器无法靠它筛掉预发布。
而 REST API `GET /repos/{owner}/{repo}/releases` 每个版本都带 `prerelease: boolean`，
可以用它精确过滤。

> 实测：`Scighost/Starward` 最近 100 条 release 里有一半（50 条）是 prerelease。
> 不做过滤，列表会被预发布刷屏。

## 功能

- 支持一个或多个仓库，各自生成独立 feed（也可合成一个）
- **精确**过滤 prerelease（依据 API 字段，而非 tag 命名猜测）
- 同时排除 `draft` 草稿（未发布版本）
- **正文取自 GitHub 官方 `releases.atom`**，是已渲染好的完整 HTML —— 图片、链接、排版和官方源完全一致，不会丢失内容
- 输出**标准 Atom 1.0**（`application/atom+xml`），不绑定任何阅读器
- 零成本跑在 Cloudflare Workers 免费额度上，URL 永久可用、无需本地常开

## 部署形态

Cloudflare Workers（本目录即 Worker 工程）。部署方式见 [DEPLOY.md](DEPLOY.md)。

## 使用

部署后获得一个 Worker URL，例如 `https://gh-release.atom.你的子域.workers.dev/`。
订阅时用查询参数指定仓库：

```
https://<worker>.workers.dev/?repo=Scighost/Starward
https://<worker>.workers.dev/?repo=Scighost/Starward&repo=other/other   # 多仓库合成一个 feed
```

## 目录结构

```
├── src/worker.js     # Worker 主逻辑：拉 API、过滤、生成 Atom
├── wrangler.toml     # Worker 配置
├── package.json      # 依赖与脚本
├── README.md
└── DEPLOY.md         # 部署指引（wrangler 命令行）
```
