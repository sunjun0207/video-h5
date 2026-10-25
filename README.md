# 映界（video-h5）

Vite + React + TypeScript 视频站。版式参照常见长视频网站：顶栏搜索、频道导航、焦点图加热播榜、海报墙、筛选、详情、选集播放。工程分层参照 fmusic-h5，没有改动那个项目。

片库是可公开播放的开放短片（Blender 开放电影预告、CC0 花朵短片、W3C 测试片），用来把检索、收藏、历史和播放跑通。

## 快速开始

需要 Node.js ≥ 18。

```bash
npm install
npm run dev
```

浏览器打开 `http://localhost:5174`。

```bash
npm run build        # 等同 build:pro
npm run preview
```

## 多环境

| 文件 | mode | 命令 |
|------|------|------|
| `.env.local` | 默认 | `npm run dev` / `npm run build:local` |
| `.env.dev` | `dev` | `npm run dev:dev` / `npm run build:dev` |
| `.env.pro` | `pro` | `npm run dev:pro` / `npm run build` |

变量都以 `VITE_` 开头。`.env.local` 会在所有 mode 下作为基础值加载，`.env.dev` / `.env.pro` 覆盖同名项。Vite 不允许 `--mode local`，所以本地开发不传 mode。

| 变量 | 说明 |
|------|------|
| `VITE_APP_ENV` | `local` / `dev` / `pro` |
| `VITE_APP_TITLE` | 页面标题，`index.html` 里的 `%VITE_APP_TITLE%` |
| `VITE_BASE` | 部署基础路径 |
| `VITE_SOURCEMAP` | 是否生成 sourcemap |
| `VITE_DEV_PORT` | 开发端口，默认 `5174`，避开 fmusic-h5 的 `5173` |

## 页面

| 路由 | 说明 |
|------|------|
| `#/` | 首页：焦点图、热播榜、各频道海报 |
| `#/channel/tv` | 频道筛选。`tv` `movie` `variety` `anime` `kids` `doc` |
| `#/search?q=` | 搜索 |
| `#/detail/:id` | 详情、选集、收藏 |
| `#/play/:id/:ep` | 播放，记下进度 |
| `#/favorite` | 收藏 |
| `#/history` | 观看历史 |

收藏、历史和搜索记录在 `localStorage`。

## Docker

形态与 fmusic-h5 相同：两阶段镜像，按 `BUILD_MODE` 读 `.env.local` / `.env.dev` / `.env.pro`，容器启动时把 `VITE_*_TARGET` 渲染进 nginx，反代 `/api-video-pomelo7-server/*`。证书放 `docker/<env>/ssl/fullchain.pem` 和 `privkey.pem`。

```bash
npm run docker:local:build
npm run docker:local:up          # http://localhost:8090
npm run docker:local:logs
npm run docker:local:down

npm run docker:local:https:cert  # 一次，生成 docker/local/ssl
npm run docker:local:https:build
npm run docker:local:https:up    # https://localhost:8444

npm run docker:dev:build && npm run docker:dev:up
npm run docker:pro:build && npm run docker:pro:up
```

生产域名示例：`SERVER_NAME=video-h5.pomelo7.top npm run docker:pro:up`。默认端口 80/443，和音乐站同时部署时用 `HTTP_PORT` / `HTTPS_PORT` 错开。

## 目录

| 路径 | 说明 |
|------|------|
| `src/lib/catalog.ts` | 开放样片片库 |
| `src/lib/api.ts` | 频道、搜索、榜单、相关推荐 |
| `src/lib/storage.ts` | 收藏、历史、搜索记录 |
| `src/lib/router.ts` | hash 路由 |
| `src/pages/*` | 首页、频道、搜索、详情、播放、收藏/历史 |
| `vite.config.ts` | 按 mode 读 `.env.*` |
