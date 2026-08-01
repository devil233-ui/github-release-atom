# GitHub Release → Atom（过滤 prerelease）

把 GitHub 仓库的 **Releases** 拉下来，用 REST API 的 `prerelease` 字段精确过滤掉预发布版，
生成一个 **标准 Atom feed**，供任意 RSS/Atom 阅读器订阅（Feedbro、Tiny Tiny RSS、NetNewsWire 等均可）。

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
