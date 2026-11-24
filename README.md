# WordLoom

一座公开可读的英语词卡库。任何人都能搜索、翻阅词卡；词卡由管理员用 AI 生成，一张卡上分层写着音标、词源、认知意象、家族对比和边界测试。

## 功能

**Word Forge** — 词卡库：谁都能查，管理员能造

所有人，不用登录：

- **搜索**：一个搜索框，输入即过滤，按输入内容决定搜哪一列
  - 含中文 → 只匹配释义（coreMeaning）
  - 单个英文单词 → 只匹配单词（word）
  - 其余（多词短语等）→ 单词和释义都匹配
- **相关性排序**：搜索结果按 `精确匹配 > 前缀匹配 > 子串匹配 > 仅释义命中` 排序，再叠加 usageCount 和 createdAt——输入 `set` 时 `setup` 排前面，`asset/closet` 排后面，永远找得到精确那张（usageCount 是旧版留下的使用计数，现在没有入口再累加）
- **浏览**：CEFR 等级筛选（A1–C2），每页 20 张；不搜索时新卡在前
- **读词卡**：点开任意一张，内容见下面的"词卡结构"

管理员登录后多出：

- **查/造合一**：还是那个搜索框——输入的单词在词库里没有精确匹配时，出现"生成词卡"，回车即可生成
- **三种生成入口**：输入一个单词、一次输入多个（逗号/空格分隔，最多 10 个）、粘贴文本由 AI 抽取生词后勾选
- **重复检测**：已有单词不再调用 AI 重新生成，直接返回已有卡片
- **卡片生成走异步 Job 队列**，状态由服务端权威返回（queued/running/done/failed/cancelled），可以取消
- **深度分析手动触发**：新卡只有基础层。在词卡里点"生成深度分析"，或用列表上方的 Retry Deep (N) 给所有缺的卡批量补；生成后存库，再打开不会重复调用 AI
- **删除词卡**

词卡结构：

- **卡头** — 单词、音标、词性、CEFR 等级、WAD/WAP 指标
- **词根词源 (Etymology)** — 词源说明；有深度分析时附语义演化链条（Evolution Chain）
- **深度分析**（没生成过的卡只有上面两项）：
  - **核心意象 (Core Image)**：AI 为每个单词定制生成专属 SVG 动画（如 engage → 齿轮咬合，diverge → 路径分叉），附画面描述。无法生成时 fallback 到 5 种认知图式模板（blockage / container / path / link / balance）
  - **场景激活 (Frame Activation)**：可折叠。单词在不同领域下的典型框架：情景描述、例句与关联词群
  - **家族对比 (Family Comparison)**：可折叠。横向对比表格显示同源/易混淆词汇的核心区别、情感语域和典型场景，并附总结式辨析笔记
  - **边界测试 (Boundary Tests)**：可折叠。填空题，答案先遮住；点"显示答案"后列出各备选词的对错和原因

基础层还生成并存下了搭配、分级例句、语境阶梯、常用短语、近反义词和易混词，目前的词卡页面不展示它们（API 响应里有）；释义只出现在列表里，截到 40 个字符。

**移动端适配**

- 卡片详情页使用原生全屏 overlay（非 Dialog），滚动流畅无截断
- 紧凑排版：缩小标题/字号/间距，核心意象描述降为辅助色
- 关闭按钮 sticky 跟随滚动

**主题**

- 亮色：默认 shadcn/ui
- 暗色：Solarized Dark 配色方案（base03 背景 #002b36，cyan accent #2aa198，blue primary #268bd2）

**已移除**

- Story Studio、Chunk Forge、练习、图片生成和 TTS 的代码都已删除。`stories` / `practices` / `chunks` 三张表和里面的数据原样留在库里，应用不再读写
- 语块可以导出成一份 Markdown（只读，不改数据库）：`node tools/export-chunks.mjs <app.db 路径> <输出.md>`

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 19, Vite, Tailwind CSS v4, shadcn/ui, TanStack Query |
| 后端 | Hono (TypeScript), Node.js |
| 数据库 | SQLite (Drizzle ORM + libSQL) |
| AI | 双 Provider：Gemini API + OpenAI-compatible（DeepSeek / GLM / Grok / Kimi 等中转站） |
| 部署 | systemd + 宿主机 nginx（可选 Docker） |
| PWA | vite-plugin-pwa, autoUpdate + controllerchange 自动刷新 |

## 快速开始

```bash
# 安装依赖
pnpm install

# 启动开发服务器（前后端同时启动）
pnpm dev
```

浏览器访问 `http://localhost:5173`，进入 AI Providers 页面配置连接和模型。

### 导入已有词库（可选）

数据库不在 Git 里，新克隆的仓库是空库。`seed/wordloom-seed.db.gz` 是一份词卡和语块的快照（不含 API key、网关地址、登录会话、故事和练习），在**首次启动前**解压到 `data/app.db` 即可：

```bash
gunzip -c seed/wordloom-seed.db.gz > data/app.db
```

Windows（PowerShell）没有 `gunzip` 时可用 7-Zip 解压后改名为 `data/app.db`。导入后仍需在 AI Providers 页面填写自己的 API key。这是某一时刻的快照，不会随线上数据自动更新。

## AI 服务配置

应用内分为两个配置页面：

### AI Providers（`/providers`）— 需要登录

管理 AI 连接、模型探测和路由分配。此页面需要管理员登录才能访问。

- **双 Provider 支持**：Gemini（官方或中转站）+ OpenAI-compatible（DeepSeek / GLM / Grok / Kimi 等），各自独立的 API Key 和 Base URL
- **Detect & Verify**：探测中转站实际可用模型，逐个 ping 验证可用性（并发 5，自动过滤不可用模型）
- **Model Routing**：Cards / Deep / Utility 三条路由，每条可独立选择 provider + primary model + fallback model
- **Test Routes**：每条路由可单独 ⚡ 测试，也可 Test All Routes；Cards / Deep 检查返回的 JSON 结构，Utility 检查能否返回文本
- **测试结果持久化**：绿点/红点 + 失败原因保留在 sessionStorage，刷新不丢失
- **API Key 只写不读**：存下的 key 不会再发回浏览器，页面只知道"已配置"；输入框留空保存表示保留原值

### Settings（`/settings`）— 公开，管理员多两项

页面任何人可访问。存在浏览器里的偏好谁都能改；存在服务端的设置只有管理员看得到、改得了。

- **Appearance**：亮色 / 暗色 / 跟随系统
- **App Refresh & Cache**：强制刷新 PWA、清理本地缓存
- **Account**：管理员登录 / 退出登录（手机上没有侧边栏，这里是唯一的入口）
- **Language**（管理员）：解释性文本语言偏好（简体中文 / English / Bilingual）
- **Network Tolerance**（管理员）：可调 `api_timeout_ms`（默认 60s，deep 路由自动 ×2）和 `api_max_retries`（默认 3）

### 容错机制

- **Per-route timeout 倍率**：Deep ×2，适配长输出
- **智能重试**：仅重试暂态错误（502/503/timeout/rate limit），配额超限（RPD/TPD/quota）和认证错误立即失败
- **Model fallback**：primary 失败后自动尝试 fallback model
- **日志可追溯**：retry 和 fallback 切换均打印具体错误原因

### 权限与安全

- **默认拒绝**：`/api/*` 下除白名单外一律需要管理员会话，否则 401。白名单只有读词卡（`GET /api/cards`、`GET /api/cards/:id`）、登录 / 退出 / 查询登录状态、健康检查，清单在 `src/server/middleware/guard.ts`。新加的路由不进清单就是私有的
- **访客只读**：搜索、翻页、看词卡不用登录；生成、抽词、深度分析、删除、任务队列和所有设置都是管理员的
- **管理页面**：AI Providers (`/providers`) 需要管理员登录，未登录时导航里不出现
- **API key 不回传**：`GET /api/settings` 只对管理员开放，对 key 只回答有没有配置，不返回值
- **CSRF 防护**：GET / HEAD / OPTIONS 之外的请求强制检查 Origin header
- **CSP**：禁止内联脚本和未列出的来源；AI 写的 SVG 只通过 `<img>` 显示，里面的脚本不会执行
- **限流**：登录、生成、抽词各自按 IP 每分钟 20 次

### 生成任务机制（Async Jobs）

- `POST /api/cards/generate?async=1` 会立即返回 `202 + jobId`
- 前端任务队列轮询 `GET /api/jobs/:id` 获取权威状态（queued/running/done/failed/cancelled）
- 可通过 `POST /api/jobs/:id/cancel` 发起取消（best effort）
- 兼容旧客户端：不带 `async=1` 仍可走同步返回
- 以上接口都需要管理员会话
- 深度分析（`POST /api/cards/:id/deep`）不走队列，同步返回

### 配置参考

| 配置项 | 说明 | 默认值 |
|---|---|---|
| Gemini API Key | Gemini API 密钥或中转站密钥 | 按需填写 |
| Gemini Base URL | 留空用 Google 官方 API；填中转站地址走代理 | Google 官方 |
| OpenAI API Key | OpenAI-compatible 提供商的 API 密钥 | 按需填写 |
| OpenAI Base URL | 如 `https://api.deepseek.com` | 必填（使用 OpenAI provider 时） |
| `{route}_provider` | 每条路由的 AI 提供商 | `gemini` |
| Cards Model / Fallback | 卡片生成（短 JSON）主/备模型 | 见表下说明 / 空 |
| Deep Model / Fallback | 深度分析（长 JSON）主/备模型 | 见表下说明 / 空 |
| Utility Model / Fallback | 轻量任务（抽词）主/备模型 | 见表下说明 / 空 |
| API Timeout | 单次 AI 请求超时（deep 自动 ×2），可设 5–300 秒 | `60000` ms |
| Max Retries | 每个模型最多尝试几次（含第一次），可设 1–6 | `3` |

主模型留空时：Gemini 路由用 `gemini-2.5-flash`（库里留有旧版的 `general_model` 设置时用它）；OpenAI-compatible 路由没有默认值，必须选一个。

**使用中转站示例**：如果你的中转站是 `https://x666.me`，在 AI Providers 中：
- API Key → 中转站给的 key
- API Base URL → `https://x666.me`
- 先点 **Detect & Verify** 探测并验证可用模型
- 在 Cards / Deep / Utility 路由里从检测结果中选主模型和 fallback
- 点 **Test All Routes** 或每条路由的 ⚡ 验证实际可用性

## 项目结构

```
src/
├── client/                 # React SPA
│   ├── components/
│   │   ├── cards/          # Word Forge（统一查/造输入、词卡详情、集合视图）
│   │   ├── settings/       # SettingsPage + AIProvidersPage + SettingWidgets
│   │   ├── layout/         # 导航壳（3 tab: Cards/AI/Settings，AI 仅管理员可见）、任务面板、错误边界
│   │   ├── auth/           # 登录页、AuthGuard、AdminOnly
│   │   └── ui/             # shadcn/ui 组件
│   ├── hooks/              # TanStack Query hooks（useCards / useSettings / useAuth）
│   ├── lib/                # API 客户端、SVG 转图片、工具函数
│   └── store/              # Zustand（任务队列、主题）
├── server/                 # Hono 后端
│   ├── index.ts            # 进程入口：生产环境缺 AUTH_TOKEN / AUTH_SECRET 时拒绝启动
│   ├── app.ts              # 中间件顺序 + 路由装配（测试直接 import，不占端口）
│   ├── routes/             # API 路由（auth, cards, settings, settingsTest, jobs）
│   ├── services/
│   │   ├── ai-router.ts    # Provider 分发（读 {route}_provider 设置）
│   │   ├── ai-shared.ts    # Retry/timeout/settings/semaphore/fallback
│   │   ├── ai-prompts.ts   # Prompt 常量 + 语言指令（cards / deep）
│   │   ├── ai-normalize.ts # JSON 解析 + schema drift 容错
│   │   ├── gemini.ts       # Gemini SDK 调用
│   │   ├── openai-compat.ts # OpenAI-compatible raw fetch 调用
│   │   ├── jobs.ts         # 异步任务（建任务、状态流转、启动时清理孤儿任务）
│   │   └── semaphore.ts    # AI 调用的并发上限
│   ├── middleware/         # guard（/api 默认拒绝 + 公开白名单）、auth（httpOnly cookie + HMAC session）、rateLimit
│   └── db/                 # Drizzle schema + 连接（stories / practices / chunks 只剩表定义）
└── shared/                 # 前后端共享类型、校验和默认值（types.ts, validation.ts, defaults.ts）

drizzle/                    # SQL 迁移（0006 含 lower(word)/lower(form) 表达式索引）
tools/                      # 运维脚本（backup-db.sh 备份、export-chunks.mjs 导出语块）
deploy/                     # systemd 单元文件、nginx 的 Cloudflare 真实 IP 片段
seed/                       # 可选的词库快照
tmp/                        # 批量造卡脚本 batch-cards.ts 和它读的 CEFR 词表
```

## 搜索与列表性能

词库是几千张卡的量级。在一份 3,380 张卡的库上实测 SQL 耗时：生成前的查重不到 1ms，一次搜索 3–30ms（命中越多越慢）。

- **表达式索引**：`drizzle/0006_word_form_lower_indexes.sql` 给 `cards.word` 建了 `lower(word)` 表达式索引，生成前的查重（大小写不敏感的等值匹配）走索引。搜索是子串匹配，用不上索引，每次都是全表扫描——表小，所以够快
- **相关性排序**：`ORDER BY CASE WHEN exact / prefix / substr / meaning-only END, usageCount DESC, createdAt DESC` 让精确匹配置顶
- **字段分流**：单个英文单词只搜词形、含中文只搜释义、多词短语两者都搜——彻底消除"输入完整单词被语义释义里的同字串误中"
- **TanStack Query `placeholderData`**：翻页/改搜索词时旧数据保留，不闪 loading
- **`React.memo` + 稳定回调**：卡片列表 hover/打开详情/删除时邻卡不重渲
- **搜索输入 debounce**：300ms 合并连续按键，避免每按键一次请求

## 部署

### Systemd（单机部署推荐）

适合你这种只有一台服务器、宿主机 nginx 直接反代 `127.0.0.1:3001` 的场景。核心思路是：

- `pnpm build` 产出 `dist/`
- `systemd` 负责守护 `node dist/server/index.js`
- 数据直接使用仓库内的 `data/` 目录

```bash
cp .env.example .env
# 编辑 .env：
#   AUTH_TOKEN=你的登录密码
#   AUTH_SECRET=随机字符串（用于 cookie 签名）

pnpm build
sudo cp deploy/systemd/wordloom.service /etc/systemd/system/wordloom.service
sudo systemctl daemon-reload
sudo systemctl enable --now wordloom
```

常用命令：

```bash
sudo systemctl restart wordloom
sudo systemctl status wordloom
journalctl -u wordloom -n 100 --no-pager
```

#### 反向代理与真实 IP

限流按客户端 IP 计数，应用**只信任 `X-Real-IP`**（不读 `X-Forwarded-For`，它可被客户端伪造）。因此 nginx 必须设置：

```nginx
proxy_set_header X-Real-IP $remote_addr;
```

如果站点在 Cloudflare 后面，`$remote_addr` 默认是 Cloudflare 节点的地址，所有访客会共用一个限流计数：有人猛刷登录接口，管理员自己也会被挡在登录之外。把 `deploy/nginx/wordloom-cloudflare-realip.conf` 放到 `/etc/nginx/snippets/` 并在 server 块里 `include`，nginx 会只对来自 Cloudflare 网段的连接采信 `CF-Connecting-IP`。Cloudflare 网段偶尔变动，对照 <https://www.cloudflare.com/ips/> 更新。

#### 反代超时

深度分析是一次同步请求：按默认设置单次尝试最多等 120 秒（`api_timeout_ms` × 2），失败还会重试；而 nginx 的 `proxy_read_timeout` 默认只有 60 秒。模型慢的时候浏览器会先收到 504，词卡上显示生成失败——服务端其实没停，生成完照样存库，稍后刷新页面就能看到（马上点重试会再生成一遍）。想让请求等到结果，在反代的 `location` 里调大 `proxy_read_timeout`（比如 `300s`）；前面还有 CDN（如 Cloudflare）的话，它有自己的上限。

#### 数据库备份

`tools/backup-db.sh` 用 `sqlite3 .backup` 做一致性快照、校验后压缩到 `backups/`，默认保留 14 天。建议挂 cron：

```cron
17 4 * * * /path/to/wordloom/tools/backup-db.sh >> /path/to/wordloom/backups/backup.log 2>&1
```

`backups/` 与数据库在同一块盘上，只防误删和写坏，不防磁盘损坏；重要数据请再同步到机器之外。

### Docker

```bash
cp .env.example .env
# 编辑 .env：
#   AUTH_TOKEN=你的登录密码
#   AUTH_SECRET=随机字符串（用于 cookie 签名）

docker compose up -d --build
```

适合你明确想把运行时和宿主机隔离开时使用（线上实例用的是上面的 systemd 方式，Docker 路径未随每次发布验证）。根目录的 `nginx.conf` 是配合它的反代示例。注意 Docker 默认会把 SQLite 放进 named volume，不会直接使用仓库里的 `data/` 目录。

### 手动部署

```bash
pnpm build          # 构建前端 + 后端
pnpm db:migrate     # 运行数据库迁移
pnpm start          # 启动生产服务器（端口 3001）
```

## 开发检查

```bash
npx tsc -b --force   # 类型检查（根目录的 tsc --noEmit 不检查任何文件）
pnpm lint
pnpm test            # 使用内存 SQLite，不会碰 data/app.db
```

CI（`.github/workflows/ci.yml`）在 push / PR 时跑同样的检查，外加构建和生产依赖审计。

## 环境变量

| 变量 | 说明 | 必填 |
|---|---|---|
| `AUTH_TOKEN` | 管理员登录密码（在 `/login` 输入） | 生产环境必填 |
| `AUTH_SECRET` | Cookie 签名密钥（随机字符串） | 生产环境必填 |
| `ALLOWED_ORIGINS` | 允许跨域访问 API 的前端 Origin（逗号分隔）。不设置时只接受同站请求 | 否（前后端同域时不需要） |
| `DATABASE_URL` | SQLite 连接字符串 | 否（默认 `file:data/app.db`） |
| `PORT` | 服务端口 | 否（默认 3001） |

开发环境不设置 `AUTH_TOKEN` 则跳过认证，所有人都按管理员对待。

权限模型：访客只能读词卡；`/api/*` 下其余的一切（生成、抽词、深度分析、删除、任务、设置）都需要管理员登录。公开白名单见 `src/server/middleware/guard.ts`。

## License

MIT
