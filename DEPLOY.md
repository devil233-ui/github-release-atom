# 部署（Cloudflare Workers，命令行方式）

前提：**已有 Cloudflare 账号**。全程用 `wrangler`，免费。

## 一、安装 Node 与 wrangler

本机已有 Node（NVM 下 `v24.14.0`）。在项目目录安装 wrangler 并登录：

```bash
cd github-release-atom
npm install          # 安装 wrangler（本地依赖）
npx wrangler login   # 会弹出浏览器，授权你的 Cloudflare 账号
```

> `wrangler login` 只做本地授权，不会把你的 Worker 交给别人。

## 二、登录并部署

```bash
npx wrangler deploy
```

首次部署会让你**选择或创建 workers.dev 子域名**（例如 `ghfeed`），只有一个，后续复用即可。
部署成功后控制台会给出你的 Worker 地址，形如：

```
https://github-release-atom.<你的子域名>.workers.dev/
```

## 三、订阅

在 Feedbro（或其他阅读器）里添加订阅，URL 填：

```
https://github-release-atom.<你的子域名>.workers.dev/?repo=Scighost/Starward
```

多仓库合成一个 feed：

```
https://github-release-atom.<你的子域名>.workers.dev/?repo=Scighost/Starward&repo=other/repo
```

临时看含 prerelease 的版本（对照验证过滤是否正确）：

```
https://github-release-atom.<你的子域名>.workers.dev/?repo=Scighost/Starward&pre=1
```

## 四、本地预览（可选）

不部署也能本地生成并检查 Atom：

```bash
npx wrangler dev --local --port 8787
# 另开终端：
curl 'http://127.0.0.1:8787/?repo=Scighost/Starward'
```

## 五、升级限流（可选）

GitHub 未认证限流 60 次/小时/IP。默认 Worker 加了 5 分钟 Cache，个人订阅足够。
若你是高频使用者，可加 token：

```bash
npx wrangler secret put GITHUB_TOKEN
# 粘贴一个 GitHub Personal Access Token（只需 public repo 读权限）
```

## 常见问题

- **看不到新版本？** Feed 有 5 分钟缓存；且 Workers 免费版还有 CDN 缓存（默认 ~1 分钟到几分钟）。稍等即刷新。
- **想隐藏接口重命名？** 没问题，这是你自己的 Worker，地址只有你知道。
- **更新代码后**：改完 `src/worker.js` 再 `npx wrangler deploy` 即可。
