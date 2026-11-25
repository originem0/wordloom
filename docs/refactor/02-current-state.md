# WordLoom 现状调研（重构前）

> 2026-11-26 状态更新：下文是 `75f7caf` 的重构前调研，路由、权限、行数与未验证事项属于该基线。当前实现与最新验收见 [07-ui-experience.md](07-ui-experience.md)，阶段变更见 [04-progress.md](04-progress.md)，不要把旧公开面或旧入口当成现状。

2026-11-24 · 对应 HEAD `75f7caf` 的工作区

`01-plan-v3.2.md` 说做什么，这份说凭什么：代码现在长什么样，数据说明了什么，评审中查过什么、否掉过什么。写它是为了让接手的人不必把同样的调研再做一遍，也不必把已经否掉的方案再争一遍。

行号都对着 HEAD `75f7caf`；`src/` 下没有未提交的改动。代码一动行号就会漂，引用之前先 grep。

没有特别标注的事实，是我对着代码、数据库的只读副本或原文核过的。评审成员报告而我没有复核的标「报告」，按行号范围或经验估的标「估」。第 13 节有汇总。

## 1. 基线

| 项 | 值 |
|---|---|
| 仓库 | `D:\Development\Apps\wordloom`，分支 `main`，HEAD `75f7caf`（chore: add a seed snapshot of cards and chunks） |
| 远端 | `git@github.com:originem0/wordloom.git`。**公开仓库**：2026-11-24 不带凭据请求仓库主页，返回 200 |
| 未提交 | `.claude/settings.local.json`、`README.md`（+6 行）、`package.json`（`dev:server` 一行）有改动，出自更早的会话；`docs/`、`tmp/cefr_cache.json`、`tmp/word.xml` 未跟踪 |
| 线上 | 单机 systemd：`node dist/server/index.js`，工作目录 `/home/ubuntu/wordloom`，`.env` 提供 `AUTH_TOKEN` 与 `AUTH_SECRET`，`NODE_ENV=production`（deploy/systemd/wordloom.service:10-14）。宿主机 nginx 反代 127.0.0.1:3001，前面是 Cloudflare（README:241、:267-275，app.ts:33-35） |
| 备份 | `tools/backup-db.sh`：`sqlite3 .backup`，`integrity_check` 通过后 gzip，留 14 天；和数据库在同一块盘（README:277-285） |
| Node / pnpm | 本机 v26.13.0 / 10.32.1；CI 是 22 / 9（ci.yml:23、:26）；Dockerfile 是 `node:20-slim`（:2、:17） |

`.claude/settings.local.json` 写在 `.gitignore` 里却仍被跟踪，`git add -A` 会把它带上。

| 命令 | 作用 |
|---|---|
| `npx tsc -b --force` | 类型检查。根目录的 `tsc --noEmit` 不检查任何文件（README:311） |
| `pnpm lint` | eslint |
| `pnpm test` | vitest，用内存 SQLite，不碰 `data/app.db`（README:313） |
| `pnpm build` | `vite build`，再用 tsup 打服务端（package.json:10） |
| `pnpm dev` | 前后端一起起。`dev:server` 先跑 `pnpm db:migrate`（package.json:9），**会写 `data/app.db`** |
| `pnpm db:generate` / `pnpm db:migrate` | drizzle-kit（package.json:12-13） |
| `pnpm audit --prod --audit-level high` | CI 里跑（ci.yml:41） |

服务启动时也会自动应用迁移（db/index.ts:16）。也就是说，`drizzle/` 里多一个迁移文件，下一次启动就改库。

测试现有 28 个文件、4,549 行。旧计划记的是 279 项通过；这一轮没有重跑。

## 2. 技术栈与结构

React 19、Vite 8、Tailwind v4、shadcn/ui、TanStack Query、Zustand、react-router-dom 7、vite-plugin-pwa；Hono 4（@hono/node-server）、Drizzle ORM 0.45 加 drizzle-kit 0.31、@libsql/client 0.17（本地 SQLite，WAL）、zod 4；模型接入是 @google/genai 加一套 OpenAI 兼容的裸 fetch；vitest 4 与 Testing Library；tsup；pnpm。`sharp` 和 `edge-tts-universal` 只服务于 Story、Practice 和 TTS。

行数是非测试代码，含空行。

| 位置 | 文件（行数） | 说明 |
|---|---|---|
| `src/server/index.ts` | 27 | 生产环境缺 `AUTH_TOKEN` 或 `AUTH_SECRET` 即退出（:3-8）；把上个进程留下的任务标为失败；监听 `PORT`，默认 3001 |
| `src/server/app.ts` | 170 | 装配。顺序：logger :22，CSP :28-50，CORS :71-79，写请求的 Origin 检查 :81-94，写守卫 :96，health :99，auth :102，其余路由链式挂载 :108-114，静态文件 :121-137，SPA 回退 :140-155，全局错误处理 :160-167 |
| `src/server/middleware/` | auth 38、writeGuard 41、rateLimit 133 | 见第 4 节 |
| `src/server/routes/` | settingsTest 1,087、cards 437、stories 400、chunks 386、practice 289、auth 81、settings 71、jobs 41 | settingsTest 经 settings.ts:71 挂在 `/api/settings/test` |
| `src/server/services/` | openai-compat 647、gemini 572、ai-normalize 541、ai-prompts 388、ai-shared 212、jobs 167、ai-router 135、edgeTts 63、semaphore 46、image 32、tts 31 | 见第 5 节 |
| `src/server/db/` | schema 137、index 16 | 见第 6 节 |
| `src/shared/` | types 296、validation 259 | 前后端共用的类型和 zod schema |
| `src/client/App.tsx` | 123 | 路由：`/login` :63；Shell :64；首页是 Story :65；`cards` :66；`chunks` :79；`practice` :92；`providers`（AuthGuard）:105；`settings`（无守卫）:106 |
| `src/client/components/layout/` | TaskPanel 142、Shell 132、ErrorBoundary 81 | 导航项在 Shell.tsx:10-17，对所有人显示；主题切换只在桌面侧栏（:82，侧栏是 `hidden md:flex` :58），移动端底栏（:112-129）没有 |
| `src/client/components/auth/` | LoginPage 60、AuthGuard 37、AdminOnly 13 | AuthGuard 自己请求 `/api/auth/me`，不走 TanStack |
| `src/client/components/cards/` | prototype-word-card.css 862、WordInput 332、CardCollection 315、PrototypeWordCard 314、WordForgePage 56、五个 `Schema*Proto` 共 188、UntrustedText 20；另有无人引用的 1,247 行 | 在用的详情页是 PrototypeWordCard |
| `src/client/components/chunks/` | 7 个文件共 1,131 | Chunk Forge |
| `src/client/components/story/` | 6 个文件共 1,093 | Story Studio 与 TTS 播放 |
| `src/client/components/practice/` | PracticePage 212、PracticeView 185 | 看图表达 |
| `src/client/components/settings/` | AIProvidersPage 753、SettingsPage 363、SettingWidgets 117 | |
| `src/client/components/ui/` | 7 个文件共 510 | shadcn 组件 |
| `src/client/hooks/` | useChunks 87、useCards 76、usePractice 36、useStories 32、useSettings 25、useAuth 16 | `useIsAdmin` 在加载中和出错时返回 false（useAuth.ts:8-15） |
| `src/client/store/` | tasks 390、index 17 | 任务队列，轮询 `/api/jobs/:id` |
| `src/client/lib/` | api 68、svg 22、query-client 11、theme 11、utils 6 | `apiFetch` 抛 `ApiError`（带 status 和 code） |
| `drizzle/` | 0000 到 0010 共 11 个迁移，`meta/_journal.json` | 最后一条是 idx 10 `0010_bored_magus`；`0006_word_form_lower_indexes.sql` 是手写迁移的先例 |
| `tools/` | backup-db.sh、import-chunks.py、import-chunks-batch2.py、import-chunks-resume.py | 三个 Python 脚本是灌 chunks 用的 |
| `seed/wordloom-seed.db.gz` | 10.9 MB | 词卡和语块的快照，已提交到公开仓库（README:103） |

## 3. 行数

`src` 下 119 个文件，非测试 91 个、15,966 行（非空 14,456），测试 28 个、4,549 行。2026-11-24 重跑过，数字没变。统计的是 .ts、.tsx、.css、.js、.mjs，跳过 `node_modules`、`dist` 和点开头的目录；复现脚本在 `03-implementation-guide.md` 的 1.2 节。

按文件名关键词分桶（先匹配到的算数）：

| 桶 | 非测试行 | 测试行 |
|---|---|---|
| practice | 722 | 276 |
| story（含 tts） | 1,619 | 56 |
| chunk | 1,604 | 1,497 |
| image | 32 | 120 |
| card | 3,939 | 676 |
| settings | 2,416 | 559 |
| ai-services | 2,495 | 0 |
| other | 3,139 | 1,365 |

settings 加 ai-services 是 4,911 行，占 31%，这就是 01 里说的「设置与 AI 接入」。card 桶里有 1,247 行无人引用：ActivationCard.tsx 356、WordCard.tsx 310、word-card.css 485、SchemaBlockageSvg.tsx 62、boundaryTests.ts 34。引用关系今天又核了一遍：`useIncrementUsage`（useCards.ts:60）只被 ActivationCard.tsx:5 引用；`word-card.css` 只被 WordCard.tsx:5 引用；`./boundaryTests` 只被 WordCard.tsx:7 和它的测试引用；WordCard 本身只被测试引用。PrototypeWordCard 里有一个同名的 `normalizeBoundaryTests`，是它自己的，不依赖 boundaryTests.ts。

最大的十个文件：settingsTest.ts 1,087、prototype-word-card.css 862、AIProvidersPage.tsx 753、openai-compat.ts 647、gemini.ts 572、ai-normalize.ts 541、word-card.css 485、cards.ts 437、stories.ts 400、tasks.ts 390。

能整文件删掉的是 5,224 行：practice 722、story 1,619、chunk 1,604、image 32、无人引用的词卡代码 1,247。共享文件里随之能删的部分（ai-prompts、ai-normalize、两份 provider、ai-router、shared 下两个文件、settingsTest 的分支、SettingsPage 的 TTS 一节、AIProvidersPage 的几节、rateLimit 的每日额度）按行号范围估是 1,400 到 1,700 行。所以 P0 结束时大约 9,000 到 9,500 行（估）。

## 4. 权限模型与公开面

**鉴权。** 登录后浏览器拿到一个 `session` cookie，值是随机 ID，它的 HMAC 存在 `sessions` 表。`authMiddleware`（auth.ts:29-38）验证它，失败回 401 `{ error: "Unauthorized", code: "AUTH_REQUIRED" }`。没设 `AUTH_TOKEN` 时它放行一切（:16、:31），这只可能发生在开发环境，因为生产入口缺这两个变量就退出（index.ts:3-8）。

**写。** 默认拒绝。`requireAuthForWrites`（writeGuard.ts，挂在 app.ts:96）让 GET、HEAD、OPTIONS 和白名单里的写请求直接通过，其余走 `authMiddleware`。白名单现在有 11 条（writeGuard.ts:15-27）：登录登出；`stories/generate`；`stories/:id/(tts|translate)`；`cards/(generate|extract)`；`cards/:id/deep`；`cards/:id/usage`；`chunks/generate`；`chunks/:id/usage`；`practice/generate`；`practice/:id/grade`；`jobs/:id/cancel`。写请求另有 Origin 检查（app.ts:81-94）。

**读。** 全部公开（app.ts:104 的注释写明）。没有任何读守卫。

**限流。** `rateLimit`（rateLimit.ts:37）是按 `X-Real-IP` 的内存计数窗口，登录（auth.ts:13）和各生成入口在用。`dailyLimit`（:78-124）是给匿名访客的每日额度，管理员直接跳过（:83-84）；上限读 `daily_*` 设置，一共 7 个：story、cards、deep、chunks、image、grade、utility。界面上只有其中 4 个可配（AIProvidersPage.tsx:284-288）。

全部路由：

| 方法与路径 | 位置 | 现在 | 第一版方案里 |
|---|---|---|---|
| GET `/api/health` | app.ts:99 | 公开 | 公开 |
| POST `/api/auth/login`、`/logout`；GET `/api/auth/me` | auth.ts:12、:70、:61 | 公开 | 公开 |
| GET `/api/cards`、`/api/cards/:id` | cards.ts:306、:398 | 公开 | 公开 |
| GET `/api/cards/missing-deep` | cards.ts:388 | 公开 | 管理员 |
| POST `/api/cards/generate`、`/extract`、`/:id/deep` | cards.ts:168、:217、:242 | 匿名可写，有额度 | 管理员 |
| PATCH `/api/cards/:id/usage` | cards.ts:408 | 匿名可写；界面上没有入口 | 删 |
| DELETE `/api/cards/:id` | cards.ts:428 | 管理员 | 管理员 |
| `/api/chunks/*` 七条 | chunks.ts:120、:177、:268、:281、:337、:360、:374 | generate 与 usage 匿名可写；读公开；改删要管理员 | 删 |
| `/api/stories/*` 七条 | stories.ts:169、:297、:299、:302、:327、:349、:370 | generate、tts、translate 匿名可写；读公开；删要管理员 | 删 |
| `/api/practice/*` 五条 | practice.ts:149、:188、:230、:251、:272 | generate 与 grade 匿名可写；读公开；删要管理员 | 删 |
| GET `/api/settings` | settings.ts:17 | 公开；三个 api key 一律回 `"configured"`，三个 base URL 对匿名遮住，其余原样返回 | 管理员 |
| PUT `/api/settings`、POST `/api/settings/test` | settings.ts:39、settingsTest.ts:263 | 管理员 | 管理员 |
| GET `/api/jobs/:id`、POST `/api/jobs/:id/cancel` | jobs.ts:10、:19 | 凭 UUID，不验身份 | 管理员 |
| GET `/api/jobs` | jobs.ts:37 | 管理员 | 管理员 |

01 的 1.3 节列了三个洞：匿名生成覆盖已有的 chunk 行（chunks.ts:71-90）；story 的 prompt 没有长度上限，并以最高优先级进提示词（stories.ts:185，ai-prompts.ts:80-83）；上游原始报错回传给匿名方（chunks.ts:162，cards.ts:212、:270）。重读代码时又看到几处同类的：

- `GET /api/stories/:id/tts`（stories.ts:297）是一个会触发生成的 GET，不经过写守卫。带 `?provider=gemini` 走的是 Gemini 的 TTS。它只有每分钟 30 次的限流（:234-238），没有每日额度。结果按故事正文落盘缓存（:250-260），每个故事每种 provider 只生成一次，所以暴露面有界。
- `GET /api/cards/missing-deep` 公开；词卡列表上的「Retry Deep (N)」按钮没有包在 AdminOnly 里（CardCollection.tsx:146、:153），任何访客点一下就发起 N 次 Deep 生成。
- 词卡详情一打开，如果没有深层内容就自动发起生成（PrototypeWordCard.tsx:100-108）。本机副本里 3,380 张词卡都已经有深层内容，所以现在触发不到；新生成而没补完的卡会触发。
- `hono/logger` 记录的是完整路径，**包含查询串**（node_modules/hono/dist/middleware/logger/index.js:41-46）。任何放在查询串里的东西都会进 journald，也会进 nginx 和 Cloudflare 的访问日志。
- Service Worker 把 `/api/cards` 的响应缓存 7 天（vite.config.ts:20-29），把 story 图片缓存 30 天（:30-39）。词卡是公开数据，这条规则本身没问题；要紧的是别让新的私有路由落进类似的规则。

守卫的写法有一个容易错的地方，架构师做过实验，今天重跑确认（Hono 4）：

| 守卫挂在 | `/api/expressions` | `/api/expressions/5` | `/api/expressions/5/encounters` | `/api/expressionsX` |
|---|---|---|---|---|
| `"/api/expressions/*"` | 拦 | 拦 | 拦 | 不拦（正确） |
| `"/api/expressions*"` | 拦 | 拦 | 拦 | 也拦（多拦） |
| `"/api/expressions"` | 拦 | **漏** | **漏** | 不拦 |

同一个实验里，用正则白名单做的「读默认拒绝」行为符合预期：白名单里的 `/api/cards`、`/api/cards/3` 通过，新加的任何路由（包括还没人想到要保护的）一律 401。

## 5. AI 接入

每一次模型调用都是一个请求换一个 JSON。没有多轮，没有流式，没有 embedding，不存会话。

- **路由**（ai-router.ts，135 行）：按设置项 `{route}_provider` 在 Gemini 和 OpenAI 兼容端之间二选一，没设就是 Gemini（:44-47）。route 有 story、cards、deep、utility、chunks 五个；Practice 的出题和判分借用 story 的（:124-135）；生图只走 OpenAI 兼容端（:119-122）；`generateTTS` 永远走 Gemini（:35-36）。
- **两份 provider 实现**：gemini.ts（572 行）和 openai-compat.ts（647 行）里每个任务各写一遍。一个任务的写法见 `geminiExtractWords`（gemini.ts:459-499）和 `openaiExtractWords`（openai-compat.ts:429-469）：取信号量，`runWithModelFallback`（传设置项的键名、默认模型、标签和一个 `run(model, signal)`），调模型，`parseJsonLenient`，释放信号量。模型的设置项是 `{route}_model`、`{route}_fallback_model`（Gemini）和 `{route}_openai_model`、`{route}_openai_fallback_model`（OpenAI 兼容端）。底层分别是 `getClient()`（gemini.ts:57-66）和 `openaiChat()`（openai-compat.ts:69-108），都是模块私有的。
- **公共件**（ai-shared.ts）：`getSetting` :19；`getRuntimeSettings` :46（`api_timeout_ms` 默认 60,000，`api_max_retries` 默认 3）；`retryWithBackoff` :57（只重试暂态错误）；`withTimeout` :95（到点会 abort 上游请求）；`runWithModelFallback` :144。信号量每个 provider 一组：普通 3、deep 2（gemini.ts:50-51，openai-compat.ts:44-45），占满时抛 `AI_BUSY`。
- **提示词**（ai-prompts.ts）：STORY :11，CARDS :93，DEEP :119，CHUNKS :181，PRACTICE_BRIEF :271，PRACTICE_GRADE :350。用户自定义的 story prompt 以「最高优先级」拼进去（:80-83）。
- **归一化**（ai-normalize.ts，541 行）：把模型返回的各种不规范 JSON 修成 schema 要的形状。通用件和 cards 的在 :5-216，chunks 的在 :218-409，story 的在 :411 之后。
- **异步任务**（services/jobs.ts）：`JobType = "story" | "cards" | "chunks" | "practice"`（:6）；`createJob`、`runJob`；输入和结果以 JSON 存在 `jobs` 表；前端轮询 `GET /api/jobs/:id`。
- **连通性测试**（settingsTest.ts，1,087 行）：`POST /api/settings/test` 一个 handler 按 target 分支。开头无条件按 Gemini 取 key 和 base URL（:285-286），「必须有 key」的检查（:391-402）报的也是 Gemini 的错，而 OpenAI 的 key 到 :474 和 :983 才读。现有测试没有覆盖「只配了 OpenAI 兼容端」的情况。

一处不一致，顺手记下：设置页显示的默认超时是 45000（SettingsPage.tsx:45），服务端实际默认是 60000（ai-shared.ts:48）。

## 6. 数据

表定义在 `src/server/db/schema.ts`。时间戳是普通整数列，应用写 `Date.now()`，单位毫秒；在副本上核过 cards（最早 2026-03-22T12:52Z，最晚 2026-11-22T17:32Z）。

| 表 | 位置 | 说明 |
|---|---|---|
| stories | :3-13 | 图、故事正文、artifact |
| cards | :15-46 | 词卡三层内容；`story_id` 外键指向 stories，`ON DELETE SET NULL`（:38-40） |
| settings | :48-51 | 键值对，包括 API key |
| sessions | :53-59 | 登录会话 |
| jobs | :61-74 | 异步任务的输入与结果 |
| chunks | :80-113 | 语块；`usage_count` |
| practices | :120-137 | 只存图和题。注释写明每轮作答与反馈不保存（:116-117） |

外键默认是开的（`PRAGMA foreign_keys` 返回 1）。这带来两条实验结论：`ALTER TABLE cards DROP COLUMN story_id` 直接报错；`DROP TABLE stories` 能执行，但此后 cards 的插入和删除都报 `no such table: main.stories`（更新不报）。`practices` 没有外键牵连，drop 掉是干净的。所以方案里三张表都不 drop。

本机 `data/app.db` 是剥离过的形状：cards 3,380 行，chunks 301 行，stories、practices、jobs、sessions、settings 都是 0 行，3,380 张词卡的 `story_id` 全为空。**Story 和 Practice 在线上用了多少，本机看不出来，不等于没用。** `data/app.db` 旁边有一个 31.9 MB 的 WAL 文件，和主文件差不多大；拷库要用 `.backup`，或者停服务后把三个文件一起拷。

## 7. 使用证据

日期没有特别说明的是 UTC+8；直接从库里按 UTC 统计会差出一天。

**词卡。** 3,380 张。按月（UTC）：3 月 3,139，4 月 4，5 月 24，8 月 101，9 月 83，10 月 18，11 月 11。其中 3,135 张出自 03-22 到 03-27 的批量生成，自然新增 245 张，分布在 62 天。这 62 天按月是 3、4、11、0、0、12、19、9、4（3 月到 11 月）。每张词卡都有深层内容。CEFR 分布：A1 47，A2 198，B1 663，B2 1,216，C1 1,132，C2 124。词卡的 `usage_count` 说明不了任何事：加一的界面入口自提交 `4ac324a`（2026-03-17）起就没有了，只剩 CardCollection.tsx:295-297 的显示。

**来访是成段的。** 62 个活跃日之间有 61 个间隔，中位数 1 天，最长 68 天；48 个间隔不超过 3 天；22 段连续使用里 15 段只有一两天（报告）。01 第 6 节末尾的吞吐估算就是从这里来的。

**Chunks。** 301 条：05-29 灌入 166 条，05-30 灌入 134 条，06-02 17:23 又多了 1 条（#301）。类别：verb-collocation 88，sentence-stem 78，noun-prep 55，prep-intuition 50，discourse-marker 30。`usage_count` 全是 0。`updated_at` 与 `created_at` 不同的只有 5 行（#1、6、7、8、46），都在 05-29 凌晨 01:25 到 02:01，是开发当晚的测试（报告）。06-02 之后到评审那天，174 天没有任何一行被动过。

**开发节奏。** 59 次提交，3 月到 11 月按月是 44、2、1、1、7、0、0、0、4。8、9、10 三个月一次提交都没有，词卡却新增了 101、83、18 张：站点在没人开发的时候是被用着的，用的是词卡。

**匿名访客。** 没有找到真实访客用过匿名生成的正面证据：06-02 之后 chunks 没有任何写入，245 张自然新增的词卡全是干净的单个英文单词（报告）。这支持关掉匿名生成，但它是「没看到」，不是「确认没有」。

**查过的词并没有留下。** 245 张自然新增的词卡里，有 125 张（51%）的词在 `tmp/word.xml`（欧路词典的生词本导出）里一到三年前就存过（报告）。

## 8. 用户材料里的证据

来源是用户点名的两处：`D:\tmp\ChatGPT_表达困境分析_20261123-1513.md`（下称 md）和 `D:\Learning\Notes\人生一串\Growth\英语\`（下称笔记）。这里只记位置和要点，原文不搬过来。

- 问题是用户自己说的：背过、当场又输出过一遍，第二天还是忘，下次也不一定用得出来（md:321）。「缺的是延迟提取」这个解法出自 ChatGPT 的回复（md:506），它还起草了一节项目指令（md:512-542）。评审把「试一条」提前，依据就是这两层；它不在用户列的五项功能里，所以 01 把它单独列成 U13 交给用户定。
- 笔记 `5-阅读与翻译\55-中式英语与写作易错.md`：复述之后的一次错误统计是基础层约三成、语法层约五成、表达层约两成（:14-21）；「被动识别过关、主动产出没过关」（:22）；回译时诊断出的第四个根子是语块积累不够（:24-28）。表达库瞄准的是那两成。
- 笔记 `Larry语法课程\语法测试追踪.md`：做过 17 道「给情境，自己写」（:244-260）；16 条弱点至今标着待巩固（:336-375），3 条标了已巩固（:371-373）；「已掌握清单」是空的（:388-394），标准是用户自己写的「能正确生成，而非仅能分析」。文内写的最后更新是 2025-12-08，文件最后改动是 2026-04-16。做成过的是当场写，没做成的是隔几天回来。
- 笔记 `1-方法论\16-AI辅助与提示词.md`：让 AI 当翻译机、长时间全英闲聊不适合，被追问适合（:488-494）；用户还记过 AI 在把说法判错这个方向上容易过度概括（:512）。后一条是判定评测里专门放「对但不寻常」的句子的原因。
- 笔记 `学习记录\英语随手记.md`：最近 27 条里 7 条出自那场 ChatGPT 对话，约 14 条推断是同一部剧的台词，未整理的 19 条里 18 条下面贴着 AI 的解释（报告，分类是按文风判断的）。架构师数的全文是 40 条、13,588 字。这是「收」的单位定为「逐字原句 + 标出的焦点 + 贴进来的解释」的依据，也是种子的来源。

学习者代言人的两点诊断贯穿整份方案：瓶颈是延迟之后的提取，不是解释；查过、存过不等于会。

## 9. 用户的另外两个项目

这两个项目在用户点名的范围之外，评审中发现后引用了它们，理由和范围见第 14 节。

**EnglishLearnPath**（雅思备考应用）。`app\study-engine.js` 全文 73 行，零依赖，里面有一套间隔复习规则：间隔 `[1, 3, 7, 14, 30]`（:4）；同一天不重复升档（:26-27）；每轮 3 条、每天新词至多 3 个、3 档以下的至多 12 条（:45-54）；可暂停（:18）；输入是 again / hard / good 三档自评（:23）；到期日和档位作为可变状态存着（:29-31）。方案移植的只有规则，改成对时间线的折叠，输入从自评换成「判定加提示级别」。它按日历日判断间隔（:24、:27），23:59 和 00:02 各答一次会连升两档，这个洞不照搬。用户自己用没用过它，没有验证。

**Cobrain**（Obsidian 里的 AI 对话插件）。92 次提交；留下的会话，怀疑者去掉备份和索引后数出 3 个，我按文件数是 8 个。它是「独立对话页后置」的主要依据：做出来了，没怎么用。它的 `data.json` 里有明文 API key，没有读，也不要读。

## 10. englishspeak.top 可借鉴的

用户问过这个站点哪些设计可取。我抓过它的前端资源并归纳成九点，评审之后的结论如下，其中 S1 和 S4 是评审改掉我原先说法的地方。

| # | 它的做法 | 结论 |
|---|---|---|
| S1 | 卡片分正面、背面、备注，回忆提示必填 | 改：保存永不拒绝；提示句只在进「想用」层时必填，而且要用用户自己的话；AI 提名只通过「帮我挑」按钮，至多 3 条，默认不勾 |
| S2 | 快照是复制内容，不是引用 | 采纳：三条表达共用一个来源就复制三份原文。预算是 30 秒内记得下来的东西 |
| S3 | 先说自己的版本，再给「说准确」「说地道」 | 采纳：「找」返回三组，存过的、最小改动、至多两条新说法 |
| S4 | 两个按钮自评，服务端算间隔 | 否：自评不当证据。只留「服务端算时间」；一键推翻只在用户打出过一句之后才有 |
| S5 | 产出评审（用没用上、完整、自然），5 分钟即兴加打分 | 取触发方式，不取打分；图片不要 |
| S6 | 非流式助手，一键保存 | 只取一键「收」；不存会话 |
| S7 | 最近 100 次产出的错误画像 | 后置：每句都落库，以后算得出来 |
| S8 | 多种导出 | 冻结期之后做一个手动、单向的 Markdown 导出；不做 Anki |
| S9 | 保存不等模型 | 采纳；地址栏预填永不自动提交 |

不取的：音视频流水线、内容生产线、XP、连续打卡、徽章、会员、识别型的复习模式，以及它的体量（45 个模块，约 2 MB 的 JS）。

## 11. 评审过程与否决清单

三位评审各有立场：学习者代言人（从用户的学习材料出发）、架构师（从代码和实验出发）、怀疑者（专找会白做的地方）。三轮讨论，四版终稿：v2 三方赞成，怀疑者附两个条件；v3 被学习者否决一格、被怀疑者否决七处；v3.1 被学习者否决同一格、被怀疑者否决八处；v3.2 三方赞成。票的原文在 README 的附录。

下面这些都讨论过并且否掉了。再提出来之前，先看理由有没有变。

| 方案 | 否掉的理由 |
|---|---|
| embedding、FTS5、向量索引做检索 | 库从零开始，百条以内整库索引直接进 prompt 就够。FTS5 的 trigram 在 12 条换了说法的中文需求上前三命中只有 5 条。闸门是 30 条真实需求的召回评测，不达标再谈。`libsql_vector_idx` 永不使用（见第 12 节） |
| 写导入器，批量灌入随手记或旧条目 | 批量灌入做过两次（3,135 张词卡，300 条 chunks），之后的使用都是零。条目要用户亲手挑 |
| 把 301 条 chunks 复制进 expressions | 同上；而且它们没有「第一次遇到的场景」，进了库会稀释「这是我的」 |
| 第三张表（来源快照、独立的 attempts） | 两张表够表达；多一张表多一组一致性问题 |
| 在读路径上埋点记录「看过答案」 | 改成服务端遮挡，揭晓是一次写入。读路径不埋点，证据反而更硬 |
| 把自评当掌握证据 | 学习者自己的材料显示「觉得会」和「写得出」差得远 |
| 存到期日、调度器、队列表、通知、连续天数、欠债计数 | 使用是成段的；回来看到一屏欠债是弃用的常见起点。档位从时间线折叠，间隔只是下限 |
| 独立对话页、人设、流式、会话存储 | Cobrain 的记录；准入条件写在 01 的 M11 |
| 生图、看图练习 | 用户自己说很少用；「试一条」取代了它里面有用的那一步 |
| AI 自动收录、自动判定入库、自动分类 | 收什么是用户的判断；Chunk Forge 的入库判定正是「单词收不进来」的原因 |
| 估词汇量、按 CEFR 判「应该会」、把有词卡当作会 | 查过、存过不等于会（第 7 节最后一条） |
| Anki 导出、与 Obsidian 双向同步、写作区、share_target | 都是第二个入口或第二份数据，先证明第一个入口有人用 |
| 收的时候设必填项 | 多一个必填项，少一批随手收 |
| 14 天不动自动归档 | 按日历惩罚成段的使用方式 |
| 按日历日比较间隔 | 23:59 与 00:02 的洞 |
| 先重构两份 provider 再删功能 | 重构即将删除的代码是白做；折叠排在任务类型删除之后 |
| 先加后删 | 排在后面的期通常不发生（第 7 节的开发节奏） |
| Story 留 60 天观察期 | 架构师自己撤回：本机看不到用量，观察期没有读数。改为用户看一眼线上行数再定 |
| drop 任何一张旧表 | 第 6 节的外键实验；数据留着没有成本 |

## 12. 实验

脚本和输出在 `%TEMP%\wl-analysis\`，那个目录随时可能被清；结论都在这里。实验都在仓库之外的草稿库或数据库副本上做，没有碰 `data\app.db`。

| # | 问题 | 结果 |
|---|---|---|
| exp1 | @libsql/client 0.17 的本地模式支持 FTS5 吗 | 支持：unicode61、porter、trigram 分词，bm25、highlight、外部内容表加触发器都可用 |
| exp2 | 向量列和 `libsql_vector_idx` | 能用，但建了这种索引的库，用标准 sqlite 打开时 `count(*)` 悄悄返回 0，`integrity_check` 报错，`tools/backup-db.sh` 以 1 退出且不留备份。5,000 条 768 维的索引文件 787 MB。同样的数据不建索引、直接暴力算余弦是 35 到 50 毫秒。结论：永不使用这种索引 |
| exp3 | 手写的迁移文件能被 Drizzle 的 migrator 应用吗 | 能 |
| exp4 | Hono 下的 SSE | 能用，首字节 19 毫秒，客户端断开会传到服务端。nginx 和 Cloudflare 会不会缓冲，没有测。`streamSSE` 的 onError 会把 `e.message` 写给客户端（hono 的 sse.js:26-36），真要做流式得自己包一层 |
| exp5 | 守卫模式；外键 | 见第 4 节的表和第 6 节。2026-11-24 重跑，结果一致 |
| exp6 | FTS5 的 trigram 能应付换了说法的中文需求吗 | 12 条自拟需求，前三命中 5 条；按二元组重合度是 7 条。样本小且是自拟的 |
| exp7 | 第一轮的表结构（不是终稿的）在真实库副本上迁移 | 20 到 49 毫秒，库大 0.46 MB；旧构建带着旧的迁移目录启动在迁移过的库上不报错。途中一次 `SQLITE_LOCKED` 追到是脚本里的 `EXPLAIN QUERY PLAN`，不要在 libsql 连接上跑 EXPLAIN |
| exp8 | 终稿（M5）的两张表 | 2026-11-24 做的，见下 |

**exp8。** 把 `03-implementation-guide.md` 3.1 节的迁移 SQL 作为 `0011_expression_library.sql` 加进迁移目录的副本，用 Drizzle 的 libsql migrator 应用到数据库副本的草稿拷贝上：

- 迁移 78 毫秒，`__drizzle_migrations` 从 11 条变 12 条；库从 30.18 MB 到 30.21 MB。
- 收：expressions 一行加第一条 met 行，在一个写批次里完成，第二条语句用 `last_insert_rowid()`。
- 同一个 norm 可以再存一行（另一个义项）。
- 没有命中的 looked_up 行，`expression_id` 可以为空；一次提问写两行命中，共用一个 `created_at`，按它去重能数出提问次数。
- 揭晓：写 reveal 行和读回原文在同一个写批次里。
- 作答先落库（`outcome` 为空），判定回来后在同一行回填，原文不动。
- 外键生效：指向不存在的表达会被拒绝。删掉一条表达，它的时间线级联删除，`expression_id` 为空的行留着。
- 再跑一次迁移不重复应用。**回滚路径**：拿当前构建的迁移目录（11 个）去启动迁移过的库，不报错，新表和数据留在原地。
- 旧代码路径不受影响：词卡的插入和删除正常，3,380 张都在。
- 标准 sqlite 打开：`integrity_check` 为 ok，`foreign_key_check` 无行。时间线、norm 查重、按状态列表、按天扫描四种查询都走索引。

同一天还把折叠函数的参考实现连同 18 个用例跑通了，代码和用例清单在 `03-implementation-guide.md` 的 4.6 节。

**整库索引的体量。** 架构师量过一次：303 行，8,843 个字符，平均每行 29 个字符。那是短语级的行；`text` 是整句之后这个数字不再适用，但数量级可以参考。架构师的估计（估，没有发起过模型调用）：100 条时整库进一次调用约 2 到 4 千 token；1,000 条时 2 到 4 万，仍可行，或者改两段式；到 5,000 条再考虑 embedding，存成普通 BLOB，暴力算余弦。「收」是 0 次调用；「找」是 1 次，输入约 500 加上每条 20 到 40 个 token。

## 13. 验证状态

**我核过的。** 第 1 到 6 节的代码事实和行号；行数；路由表；死代码的引用关系；提交和词卡、chunks 的按月分布；时间戳单位；exp5 和 exp8；折叠函数的 18 个用例；远端是公开仓库；logger 会记查询串；md 和笔记里引到的各行；旧计划全文；study-engine.js 全文。01 第 9 节有评审当时的清单。

**评审成员报告、我没有复核的。** 正文里标了「报告」的各条；Cobrain 的会话数；exp1 到 exp4、exp6、exp7 的细节（我读了报告，重跑的只有 exp5）。

**没有人验证过的。**

- 模型调用的延迟、费用和判定准确率。三轮评审里没有发起过一次模型调用。
- 整库索引进 prompt 之后「找」的质量。
- 线上库里 stories 和 practices 的行数。
- 测试基线（279 项）这一轮没有重跑。
- 共享文件里能删多少行、P1 加 P2 的 2,000 行预算，都是估算。
- 线上 nginx 的超时设置。仓库里的 `nginx.conf` 是 Docker 用的示例，没有设 `proxy_read_timeout`；线上那份不在仓库里。
- settingsTest 那个 bug 的确切触发条件：我读了 :258-305 和 :380-409，没有读中间的各个分支。
- EnglishLearnPath 有没有被用过。

## 14. 读取范围

用户点名的是三处：本仓库、那份对话导出、英语笔记目录。评审中另外读了用户的两个项目：EnglishLearnPath（README、提交记录、`app\study-engine.js` 全文，另有几次关键词检索）和 Cobrain（README、提交记录、会话文件的文件名、大小与时间）。它们与「这一次会不会被用起来」直接相关，所以引用了；已经告知用户并问过要不要删去，用户没有反对。

评审中还有几处范围外的读取，已单独告知用户，这组文档不引用，接手的人也不要去找。`D:\tmp` 下另有一份早期方案和一张 HTML 草图，这里只知道它们存在，没有引用内容。

没有读过的：`.env`、`.env.example`、`settings` 表里的值、`data\app.db` 本体（统计用的是只读副本）、Cobrain 的 `data.json`。
