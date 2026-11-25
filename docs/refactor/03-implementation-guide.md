# 实施指南

> 2026-11-26 状态更新：P0、P1、P2 已交付；本指南正文保留 2026-11-24 的设计与实施依据，不应重新执行删除或迁移。独立对谈、服务端历史、流式与 Rime 以 [06-talk.md](06-talk.md) 为准，当前阅读状态、分页、界面语言和词卡交互以 [07-ui-experience.md](07-ui-experience.md) 为准。后续用户决定高于旧预算与纸面步骤。

2026-11-24 · 行号对应 HEAD `75f7caf`

## 0. 这份文档的地位

`01-plan-v3.2.md` 是三位评审逐字投过票的方案，定了做什么、不做什么、按什么顺序，没有写到文件和函数这一层。这份指南把它落到代码上：P0 每一步动哪些文件，P1 和 P2 的表、接口、页面和判定规则。

**01 没写而这里写了的，都是我按 01 的原则推出来的，没有经过评审投票。** 与 01 冲突时以 01 为准。觉得某个推导不对可以改，改之前对一下 01 里对应的修正案。第 7 节把这些推导列成了一张表，方便逐条看。

两样东西实测过：3.1 节的迁移 SQL（在数据库副本上跑通，见 `02-current-state.md` 第 12 节的 exp8）和 4.6 节的折叠函数（18 个用例全过）。其余都是纸面设计。

## 1. 全局规则

### 1.1 顺序与停点

P0 删除与收口，P1 收，P2 找、试一条、流水账，然后功能冻结 4 周，判为在用才做 P3。P1 和 P2 连续交付，中间不停下来试用。

这个项目的开发是一阵一阵的（59 次提交里 44 次在头一个月），排在后面的步骤通常不发生。所以每一步结束时都得是一个能上线的完整状态，停在哪一步都不留半截。P0 的七步就是按这个要求排的。

### 1.2 预算与量法

新表至多 2 张，prompt 至多 4 个，新页面 1 个，新依赖 0 个。P1 加 P2 新增的非测试代码不超过约 2,000 行。**每一期结束时，非测试行数都不高于 15,966。**

行数这样量（含空行，跳过 `node_modules`、`dist` 和点开头的目录）。脚本放在仓库外面跑，不要提交：

```js
// node loc-min.mjs src   →  { files: 119, nonTest: 15966, test: 4549 }（2026-11-24）
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const root = process.argv[2];
const EXT = /\.(ts|tsx|css|mjs|js)$/;
function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (EXT.test(name)) yield p;
  }
}
const isTest = (rel) => rel.includes("__tests__") || /\.test\.(ts|tsx)$/.test(rel) || rel.includes(`test${sep}`);
const out = { files: 0, nonTest: 0, test: 0 };
for (const p of walk(root)) {
  const text = readFileSync(p, "utf8");
  const lines = text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
  out.files++;
  out[isTest(relative(root, p)) ? "test" : "nonTest"] += lines;
}
console.log(out);
```

### 1.3 每一步的验证

每一步结束都跑 `npx tsc -b --force`、`pnpm lint`、`pnpm test`、`pnpm build`，再量一次行数，把数字写进提交说明。删除类的步骤，删之前对每个要删的导出 grep 一次引用，这里给的清单是 `75f7caf` 时的状态。

### 1.4 迁移与备份

P0 没有迁移。P1 有且只有一个（0011），两张表一次建全。P2 不迁移。

迁移在服务启动时自动应用（db/index.ts:16），`pnpm dev` 也会先跑一遍（package.json:9）。所以：

- 本机第一次带着 0011 启动之前，先备份 `data/app.db`。它旁边有一个和主文件差不多大的 WAL，用 `sqlite3 data/app.db ".backup 路径"`，或者停掉服务后把 `app.db`、`app.db-wal`、`app.db-shm` 一起拷走。
- 线上部署带 0011 的构建之前，跑一次 `tools/backup-db.sh`，把产出的文件拷出主机，确认解得开、`integrity_check` 是 ok。脚本自带的备份和库在同一块盘上，不算数。
- 回滚就是部署上一个构建。实测过：旧构建带着 11 个迁移启动在已经迁移过的库上，不报错，新表和数据留在原地。

`stories`、`practices`、`chunks` 三张表不 drop。**它们在 `schema.ts` 里的表定义也要留着**，哪怕代码已经不再读它们：drizzle-kit 是拿 `schema.ts` 和快照比出迁移的，定义一删，下一次 `pnpm db:generate` 就会生成 `DROP TABLE`。在这三处定义上各加一行注释，说明数据保留、代码已删。

### 1.5 私人数据的规矩

表达库是这个站点上第一批私人数据，而站点的默认状态是「读全部公开」。下面每一条都对应一个已经看到的泄漏路径：

1. 私有路由整组挂鉴权，模式必须以 `/*` 结尾（写成 `"/api/expressions"` 会漏掉所有子路径，实测过）。没设 `AUTH_TOKEN` 时拒绝服务，不放行。
2. 私有响应带 `Cache-Control: no-store`。不给它们加 Service Worker 的缓存规则。
3. 私人文本不进 `jobs` 表（任务的输入和结果是整段 JSON 存着的），不进 `settings`，不进 `seed/` 的快照。
4. 私人文本不进日志。`hono/logger` 会把查询串原样打进日志，nginx 和 Cloudflare 的访问日志也一样，所以**私人文本永远不放在查询串里**：检索词、需求、预填内容都走请求体，地址栏预填用 `#` 片段。服务端不要 `console.log` 原文，报错信息里不带原文。
5. 表达原文和贴进来的对话是不可信数据：进 prompt 时放在数据区，不和指令混写；模型没有工具，不能发起写入；模型的输出按纯文本渲染（现成的有 `UntrustedText.tsx`）。
6. 登出时清掉浏览器里缓存的私有查询。现在的 `handleLogout`（Shell.tsx:45-53）只让登录状态失效。
7. 评测集里是用户自己的句子，放仓库外面，或者先把路径加进 `.gitignore` 再放。

每次「找」会把整库索引发给模型，贴进来的对话在点「帮我挑」时也会。它们经过的是用户自己配的中转站。这一条 01 的默认是告知、不拦（U9），界面上在这两个动作旁边写一句就够了。

### 1.6 提交

`git add` 写明路径，不要 `-A` 或 `.`。工作区里有三处不属于这次重构的改动（`.claude/settings.local.json`、`README.md`、`package.json`），还有两个未跟踪的 `tmp/` 文件，别带上，也别还原。`docs/refactor/` 和 `docs/plans/` 在用户明说之前不提交，原因见 README。

提交说明沿用仓库现有的写法：`fix(security): …`、`chore: …`、`fix(perf): …`。

## 2. P0 删除与收口

目标：站点只剩词卡一个公开功能，生成和一切写入只有管理员能做，读默认拒绝，代码少掉六千多行。没有迁移，不碰数据。

### 2.0 开工前

1. 跑一遍基线（1.3 的四条命令加行数），记下测试的通过数。旧计划记的是 279 项。
2. 请用户在线上库看一眼 Story 和 Practice 用了多少。本机的库是剥离过的，看不出来。在服务器上只读执行：

   ```bash
   sqlite3 -readonly data/app.db "SELECT strftime('%Y-%m', created_at/1000, 'unixepoch') AS month, count(*) FROM stories GROUP BY 1 ORDER BY 1;"
   sqlite3 -readonly data/app.db "SELECT strftime('%Y-%m', created_at/1000, 'unixepoch') AS month, count(*) FROM practices GROUP BY 1 ORDER BY 1;"
   ```

   表不 drop，数据不会丢；但界面删掉之后就没有地方看了，图片文件还在 `data/images/`。有想留着看的，在步骤 3 和 4 之前导出。如果行数说明其实一直在用，停下来和用户重新确认 U3。
3. 步骤 2 之前把 chunks 导出一次（见步骤 2）。

### 步骤 0　止血

只动服务端，二十来行。排在第一是因为它最小，而且一步关掉 01 列的全部三个洞：匿名调不到生成，就覆盖不了 chunk 行、塞不了长 prompt、也收不到上游的原始报错。

- `writeGuard.ts:15-27`：公开写白名单只留 `["POST", /^\/api\/auth\/(login|logout)$/]`。
- `stories.ts:297`：GET 的 TTS 加 `authMiddleware`。它是一个会触发生成的 GET，写守卫管不到。
- `jobs.ts:10`、`:19`：任务详情和取消加 `authMiddleware`。匿名访客已经没有任务可查。
- `cards.ts:388`：`missing-deep` 加 `authMiddleware`。
- 测试都在 `src/server/__tests__/app.guards.test.ts`，文件里有现成的 `adminCookie()`（:67-77）：
  - 「what stays open」那组（:141-173）：匿名读词卡仍是 200；计数、抽词、任务的轮询和取消改成断言 401。
  - 跨站那组（:175-194）借的是匿名的 usage 计数，换成带管理员 cookie 的 `DELETE /api/cards/:id`：跨站 403 而且词卡还在，同站 8443 端口 200。
  - 每日额度那组（:202-271）整组删掉，匿名已经走不到额度检查。
  - 「不回显内部报错」那条（:296-305）和异步端到端那组（:308-339）发的是匿名请求，带上管理员 cookie 才测得到原来要测的东西。

这一步之后匿名访客在界面上点生成会看到一个「未授权」的报错（故事页的朗读也一样），直到后面几步把这些入口删掉或收起来。这是唯一一个界面不太干净的中间态；要不要单独上线由用户定。不单独上线，它也排第一。

### 步骤 1　无人引用的词卡代码

行为零变化的纯删除。

- 删：`components/cards/` 下的 `ActivationCard.tsx`（356）、`WordCard.tsx`（310）、`word-card.css`（485）、`SchemaBlockageSvg.tsx`（62）、`boundaryTests.ts`（34），共 1,247 行；`cards/__tests__/WordCard.test.tsx`。
- 改 `cards/__tests__/untrusted-content.test.tsx`：只去掉 WordCard 的导入（:5）和 `["WordCard", …]` 那一行（:68）。「PrototypeWordCard core image」那组（:90-114）留着。
- 删 `useIncrementUsage`（useCards.ts:60 起）。
- 删 `PATCH /api/cards/:id/usage`（cards.ts:408-427）和列表上的「Used Nx」显示（CardCollection.tsx:295-297）。这个计数自 `4ac324a` 起就没有界面入口，显示的永远是旧数。`cards.usage_count` 这一列留着。
- 守卫测试里对这条路由的那一行断言（app.guards.test.ts:153）一并删掉。跨站那组在步骤 0 已经换了路由。

别误删：`PrototypeWordCard.tsx`、五个 `Schema*Proto.tsx`、`prototype-word-card.css` 是在用的，只是名字和上面这些很像。`PrototypeWordCard` 里有自己的 `normalizeBoundaryTests`，不依赖被删的 `boundaryTests.ts`。

### 步骤 2　Chunk Forge

先导出。写一个只读的小脚本（Node，用仓库里已有的 `@libsql/client`，数据库路径和输出路径都从参数传），把 `chunks` 表按类别写成一份 Markdown，输出到仓库外面。跑完之后脚本留在 `tools/` 还是删掉都行，不留路由。那 301 条本来也在 `seed/wordloom-seed.db.gz` 里。

然后删：

| 位置 | 内容 |
|---|---|
| 客户端 | `components/chunks/` 整个目录（7 个文件，1,131 行）及其测试；`hooks/useChunks.ts`（87）；`App.tsx` 的懒加载（:26）和路由（:79-91）；`Shell.tsx:14` 的导航项 |
| 服务端路由 | `routes/chunks.ts`（386）和 `routes/__tests__/chunks.routes.test.ts`；`app.ts:11` 的导入和 `:111` 的挂载 |
| AI | `generateChunk`（ai-router.ts:99-105）；`geminiGenerateChunk`（gemini.ts:408 起）；`openaiGenerateChunk`（openai-compat.ts:374 起）；`CHUNKS_PROMPT`（ai-prompts.ts:181 起）；ai-normalize.ts 的 :218-409 和 `services/__tests__/ai-normalize.chunks.test.ts` |
| 共享 | validation.ts 的 :123-202 和 `shared/__tests__/validation.chunks.test.ts`；types.ts 里 `Chunk*` 那一段（:170 起，到 `Practice` 之前） |
| 设置 | `AIProvidersPage.tsx` 的 `ROUTES`（:26-32）和 `GEMINI_DEFAULTS`（:34-48）里 chunks 的项，以及 :75 的排序分支；`settingsTest.ts` 里 chunks 模型的分支，和 `settings.modeltest.characterization.test.ts:82-89` |
| 守卫测试 | `app.guards.test.ts` 的 `seedChunk`（:49-65）和两条 chunks 用例（:105-122）；异步端到端那组（:308-339）借的是 chunks 的生成，改成借 `POST /api/cards/generate?async=1`（cards.ts:196-199）；顶部 ai-router 的 mock 清单（:8-19）跟着缩，步骤 3、4 同理 |
| 其他 | `JobType` 去掉 `"chunks"`（services/jobs.ts:6）；`gemini.abort.test.ts`、`ai-timeout.test.ts` 的 `it.each` 表里 chunk 的行；`cards.persistence.test.ts:8-17` 的 mock 清单；`tools/import-chunks*.py` 三个脚本 |

跨模块的两处链接：`StoryStudioPage.tsx:82-87` 会跳到 `/chunks?prefill=`，这一步把它去掉，否则在步骤 4 之前它指向一个不存在的页面。`ChunkInput.tsx:100` 跳到 `/cards?prefill=`，随目录一起没了。

`chunks` 表和它在 `schema.ts:80-113` 的定义留着。

### 步骤 3　Practice 与生图

| 位置 | 内容 |
|---|---|
| 客户端 | `components/practice/` 两个文件（397）；`hooks/usePractice.ts`（36）；`App.tsx` 的懒加载（:35）和路由（:92-104）；`Shell.tsx:12`；`store/tasks.ts` 里 practice 的部分（`TaskType` :7，`taskNoun` :39-40，`pollJob` 的分支 :131 起，`submitPractice` :299 起）；`TaskPanel.tsx:20` |
| 服务端路由 | `routes/practice.ts`（289）及其测试；`app.ts:14`、`:114` |
| AI | ai-router.ts 的 :115-135；gemini.ts 的 :501 到文件末尾；openai-compat.ts 里 :471 起的生图（`resolveImageConfig`、`openaiGenerateImage`）和 :582 起的出题与判分；ai-prompts.ts 的 :271 到文件末尾 |
| 共享 | validation.ts 的 :206 到文件末尾；types.ts 的 `Practice*`（:253 起） |
| 设置 | `AIProvidersPage.tsx` 的 Image Generation 一节（:529 起）、草稿初始化里的 image 键（:126-128）、`hasImageKey`（:156）、`saveAll` 里的 image 对（:264-266）、:384-386 的两处；`settingsTest.ts` 里 image 的分支；`settings.test.ts:290-302`；`image-config.test.ts`；`settings.ts` 里和 `image_api_key`、`image_base_url` 有关的两处（:13、:25） |
| 其他 | `JobType` 去掉 `"practice"`；两个超时测试的 `it.each` 表里 practice 和 image 的行；`app.guards.test.ts:126` 对 practice 的那行断言 |

`services/image.ts`（`compressImage`）Story 的上传也在用（stories.ts:136），留到步骤 4。

删 `PRACTICE_GRADE_PROMPT` 之前不用另存：P2 的判定 prompt 要参考的只是它的输出形状，已经抄在 4.2 节。

### 步骤 4　Story 与 TTS

| 位置 | 内容 |
|---|---|
| 客户端 | `components/story/` 整个目录（6 个文件，1,093 行）；`hooks/useStories.ts`（32）；`App.tsx:9` 的导入，首页（:65）改成重定向到 `/cards`；`Shell.tsx:11`；`tasks.ts` 里 story 的部分（`pollJob` 的分支 :123 起，`submitStory` :183 起）；`TaskPanel.tsx:18`；`WordInput.tsx:234` 附近那个回 Story 的链接；`SettingsPage.tsx` 的 TTS 一节（:177-252）和顶部的 TTS 常量（:37-43） |
| 服务端 | `routes/stories.ts`（400）；`services/tts.ts`（31）、`edgeTts.ts`（63）、`image.ts`（32）及各自的测试；`app.ts:9`、`:109` |
| AI | `generateTTS` 的再导出（ai-router.ts:35-36）、`generateStory`（:53-64）、`translateText`（:107-113）；gemini.ts 的 `geminiGenerateStory`（:72 起）、`generateTTS`（:160 起）、`geminiTranslateText`（:209 起）；openai-compat.ts 的 `openaiGenerateStory`（:114 起）、`openaiTranslateText`（:174 起）；ai-prompts.ts 的 :11-92；ai-normalize.ts 的 :411 到文件末尾 |
| 共享 | types.ts 开头的 `GroundingSource` 和 `Story*`（:3-66）。动之前确认词卡的类型没有引用它们 |
| 设置 | `AIProvidersPage.tsx` 的 story 路由项、`GEMINI_DEFAULTS` 里 tts 的三项（:45-47）、Gemini TTS Models 一节（:664 起）、草稿里的 `gemini_tts_voice`（:130）、`saveAll` 里 tts 的几行（:268、:281-283）；`settingsTest.ts` 里 story 和 tts 的分支，以及它对 `generateEdgeTtsMp3` 的导入（:3）；`settings.test.ts:163-198`；`settings.modeltest.characterization.test.ts:104-113` |
| 依赖 | `package.json` 里的 `sharp` 和 `edge-tts-universal`；`build` 脚本里的 `--external sharp`；`pnpm.onlyBuiltDependencies` 里的 `"sharp"`。删完跑 `pnpm install` 更新锁文件 |
| 其他 | `JobType` 只剩 `"cards"`；`jobs.test.ts:33`、`:106` 的 `createJob("story", {})` 改成 `"cards"`；`drafts.seeding.test.tsx:30-41` 用 `tts_preference` 当样例键，换一个；`useSettings.ts` 的类型注释；`vite.config.ts:30-39` 的 story 图片缓存规则；两个超时测试里 story、tts、translate 的行；`app.guards.test.ts:124-127` 剩下的那条 stories 断言 |

`stories` 表和它的定义留着，`cards.story_id` 这个外键也留着。`data/images/` 和 `data/tts/` 里的文件不动。

这一步之后，`/` 落在词卡页，导航只剩 Cards、AI、Settings。

### 步骤 5　读默认拒绝，额度系统，词卡入口收口

**守卫。** 把写守卫改成一个对所有方法都默认拒绝的守卫，公开的东西列白名单。文件可以原地改，也可以改名：

```ts
const PUBLIC: ReadonlyArray<readonly [method: string, path: RegExp]> = [
  ["GET", /^\/api\/health$/],
  ["GET", /^\/api\/auth\/me$/],
  ["POST", /^\/api\/auth\/(login|logout)$/],
  ["GET", /^\/api\/cards$/],
  ["GET", /^\/api\/cards\/\d+$/],
];

export const requireAuth = createMiddleware(async (c, next) => {
  const method = c.req.method.toUpperCase();
  if (method === "OPTIONS") return next();
  const m = method === "HEAD" ? "GET" : method;
  if (PUBLIC.some(([pm, re]) => pm === m && re.test(c.req.path))) return next();
  return authMiddleware(c, next);
});
```

这样 `settings` 的 GET、`jobs` 的全部、`cards/missing-deep` 都自动成了管理员专属，步骤 0 里临时加的那几个 `authMiddleware` 可以去掉。以后任何人新加一条路由，忘了想权限，它默认就是私有的。`app.ts:104` 那段写着「读公开」的注释要改。

`authMiddleware` 在没设 `AUTH_TOKEN` 时放行一切，所以这个守卫在不设 token 的开发环境里等于没有。这是现状，不在这一步改；私有路由的第二道门在 P1 加（3.3 节）。

**额度系统。** 匿名访客已经调不到任何生成，每日额度成了死代码。删 `rateLimit.ts` 的 :62-133（`dailyLimit`、`UTILITY_DAILY_LIMIT` 和那个延迟导入）；`cards.ts` 里三处调用（:188 起、:220、:243 起）和导入（:11）；`AIProvidersPage.tsx` 的 Usage Limits 一节（:688 起）和 `saveAll` 里对应的几行（:285-288）；`cards.dedup.test.ts` 里 `rateLimit.js` 的 mock（:44 起）去掉 `dailyLimit` 相关的项。按分钟的 `rateLimit` 留着，登录要用。`settings` 表里已有的 `daily_*` 行不用清。

**settings 的 GET。** 变成管理员专属之后，对匿名遮住 base URL 的分支（settings.ts:27-29）没用了，可以删；api key 一律回 `"configured"` 的那一段留着，密钥不该回到浏览器。

**词卡页面上的入口。** 匿名访客只该看到搜索和浏览：

- `WordInput.tsx`：生成入口（`showGenerateCta` :64，`GenerateCta` :97-98，`MultiWordBar` 的生成按钮 :94）和「从文本抽取」（`SecondaryEntries` :208 起，`ExtractPanel` :251 起）收进 `AdminOnly`。
- `CardCollection.tsx`：`useMissingDeep`（:78）只在管理员时发请求，给 `useCards.ts:53-58` 加一个 `enabled` 参数。没有数据时「Retry Deep」那一块（:140-159）本来就不渲染，不用另外包。`CardCollection.paging.test.tsx:15` 的 mock 跟着改。
- `PrototypeWordCard.tsx:100-108`：现在是一打开就自动生成深层内容，改成明确触发。没有深层内容时，管理员看到一个按钮，匿名访客什么都不触发。:195-206 的等待和报错界面相应调整。

**设置页。** `/settings` 现在对匿名开放（App.tsx:106）。不要把它整页挂上 AuthGuard：主题切换在侧栏里只有桌面端有（Shell.tsx:82），手机上换主题只能靠这一页的 Theme（SettingsPage.tsx:277），「App Refresh & Cache」（:298）对匿名访客也有用。做法是 `useSettings` 只在管理员时发请求，匿名访客只看到 Theme、App Refresh & Cache 和 About，Explanation Language（:258）和 Network Tolerance（:312）收进 `AdminOnly`。它们对匿名访客本来也保存不了。

**导航。** `Shell.tsx:10-17` 的导航项现在对所有人显示。改成匿名看到 Cards 和 Settings，管理员多一个 AI。

**测试。** 重写 `app.guards.test.ts`：公开读不带 cookie 返回 200；其余每一条路由不带 cookie 返回 401；一条根本不存在的路径（比如 `/api/brand-new/x`）也返回 401，这一条证明的是默认拒绝；带管理员 cookie 正常。可以考虑遍历 Hono 实例上的路由表来生成断言，这样以后新加的路由自动被测到，先确认当前版本的 `app.routes` 可用。

### 步骤 6　收尾

- **settingsTest 的 key 串线。** handler 开头无条件按 Gemini 取 key 和 base URL（settingsTest.ts:285-286），「必须有 key」的检查报的也是 Gemini 的错（:391-402），而 OpenAI 的 key 到 :474 和 :983 才读。先读完 :283-480，写一个会失败的测试（只配了 OpenAI 兼容端，测一个 OpenAI 的目标，不应该得到 Gemini 的报错），再修。现有测试里没有这种情况。
- **README。** 要改的段落：功能（:5 起）、AI Providers（:117-127，路由少了三条，TTS 和 Usage Limits 没了）、Settings（:129-137）、权限与安全（:146-152，「公开页面」和「每日生成限额」都变了）、生成任务（:154-159）、项目结构（:190 起）、环境变量末尾那句（:328）。README 有别的会话留下的未提交改动，在它上面接着改，不要还原。
- 顺手：设置页显示的默认超时是 45000（SettingsPage.tsx:45），服务端实际是 60000（ai-shared.ts:48），对齐成一个。

### P0 验收

1. 匿名：打开站点落在词卡页，能搜、能翻、能打开详情；看不到任何生成入口；正常浏览不出现报错提示。
2. 匿名请求任何非白名单的 `/api/*` 都是 401；已删的路由，带管理员 cookie 请求是 404。
3. 管理员：生成词卡、从文本抽取、手动触发 Deep、删除词卡、AI Providers 里测试路由、改设置，全部正常。
4. 四条检查命令全绿，`pnpm audit --prod --audit-level high` 通过。
5. `package.json` 里没有 `sharp` 和 `edge-tts-universal`。
6. `drizzle/` 没有新文件；`stories`、`practices`、`chunks` 三张表和数据原样。
7. 非测试行数：整文件删除是 5,224 行，共享文件里估计再少 1,400 到 1,700 行，落点应该在 9,000 到 9,500 之间。偏差大就查一下哪块没删干净。

01 的 M1 允许 Chunk Forge 最晚与「收」同一版、Practice 最晚与「试一条」同一版删。这里把它们都放进 P0，是因为用户选了默认；如果中途要缩短 P0，可以挪的是步骤 2 和 3，步骤 0、1、5 不要挪。

## 3. P1　收

P1 只做「见过」这一层：收、列表、详情、场景回看、又一次遇到、补注。「想用」层连同遮挡、揭晓、试一条一起在 P2 出现，P1 没有任何和证据有关的语义。表在这一期一次建全。

### 3.1 迁移

下面这份 SQL 在数据库副本上实测过（exp8）。

```sql
CREATE TABLE `expressions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`text` text NOT NULL,
	`norm` text NOT NULL,
	`focus` text,
	`intent` text,
	`intent_by` text,
	`ai_intent` text,
	`gloss` text,
	`note` text,
	`status` text DEFAULT 'seen' NOT NULL,
	`active_since` integer,
	`next_scene` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `expressions_norm_idx` ON `expressions` (`norm`);--> statement-breakpoint
CREATE INDEX `expressions_status_created_idx` ON `expressions` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `encounters` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`expression_id` integer,
	`kind` text NOT NULL,
	`text` text NOT NULL,
	`text_before` text,
	`my_attempt` text,
	`source_type` text,
	`source_title` text,
	`source_locator` text,
	`outcome` text,
	`cue` text,
	`feedback` text,
	`occurred_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`expression_id`) REFERENCES `expressions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `encounters_expression_idx` ON `encounters` (`expression_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `encounters_created_at_idx` ON `encounters` (`created_at`);
```

生成它的正路是改 `schema.ts` 之后跑 `pnpm db:generate`，让 drizzle-kit 同时更新 `drizzle/meta/` 里的快照，然后把生成的 SQL 和上面这份对一遍。`db:generate` 只比较 `schema.ts` 和快照，不连数据库。手写迁移文件而不更新快照的话，下一次生成会把这两张表再建一遍。生成出来的文件里**只应该有这两张表**；如果出现了 `DROP TABLE`，说明 1.4 节说的旧表定义被删了。

对应的 `schema.ts`，写法照现有的表：

```ts
export const expressions = sqliteTable("expressions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  text: text("text").notNull(), // verbatim; the only required field
  norm: text("norm").notNull(), // not unique: the same form can be saved as another sense
  focus: text("focus"),
  intent: text("intent"),
  intentBy: text("intent_by"), // self | find | paste | ai
  aiIntent: text("ai_intent"), // written once by the annotate call, never regenerated
  gloss: text("gloss"), // AI-written, at most three lines
  note: text("note"), // the user's own
  status: text("status").notNull().default("seen"), // seen | active | retired
  activeSince: integer("active_since"),
  nextScene: text("next_scene"), // a cache for the next prompt, not a fact
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  index("expressions_norm_idx").on(table.norm),
  index("expressions_status_created_idx").on(table.status, table.createdAt),
]);

// The timeline. Rows are never deleted and `text` is never rewritten;
// `outcome` and `feedback` may be filled in later on the same row.
export const encounters = sqliteTable("encounters", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  expressionId: integer("expression_id").references(() => expressions.id, {
    onDelete: "cascade",
  }),
  kind: text("kind").notNull(), // met | looked_up | reveal | attempt | used
  text: text("text").notNull(),
  textBefore: text("text_before"),
  myAttempt: text("my_attempt"),
  sourceType: text("source_type"),
  sourceTitle: text("source_title"),
  sourceLocator: text("source_locator"),
  outcome: text("outcome"), // pass | fail | null = not judged yet
  cue: text("cue"),
  feedback: text("feedback"), // JSON
  occurredAt: integer("occurred_at"),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  index("encounters_expression_idx").on(table.expressionId, table.createdAt),
  index("encounters_created_at_idx").on(table.createdAt),
]);
```

档位、到期时间、「用出过」都不是列，由时间线折叠得出（4.6 节）。外键写了级联删除，但第一版不提供删除接口，不想要的条目标为 `retired`。

### 3.2 各种行里每一列放什么

01 的 M5 定了有哪些列和哪些 kind，没有逐列说明。下面是补全，P1 只写得出 `met`。

| kind | `text` | `text_before` | `my_attempt` | `cue` | `outcome` | `feedback` |
|---|---|---|---|---|---|---|
| met | 遇到的那句原文，逐字 | 上文 | 空 | 空 | 空 | 空 |
| looked_up | 用户打的那句需求 | 空 | 附带的英文尝试 | `masked` 或空 | 空 | `{ turn, thread }` |
| reveal | 空串 | 空 | 空 | `masked`，或放弃时所在的一级 `none` / `need` / `scene` | 空 | 空 |
| attempt | 用户打的那句英文 | 空 | 空 | `none` / `need` / `scene` / `revealed` | `pass` / `fail`，未判为空 | 见 4.5 |
| used | 用户自发用出的原句 | 空 | 空 | 空 | 空 | 空 |

出处三列（`source_type`、`source_title`、`source_locator`）和 `occurred_at` 只在 `met` 和 `used` 行上有意义。`source_type` 的取值：`chat`、`book`、`video`、`other`，对应界面上的四个标签；另有一个只由系统填的 `find`，表示这条是从「找」里 AI 给的新说法收下来的。从「找」收下的条目，`met` 行的 `text_before` 放当时的需求，`my_attempt` 放当时附的英文尝试，场景回看靠的就是这两格。

`norm` 取 `focus`，没有焦点就取 `text`，再去首尾空白、转小写、把连续空白压成一个空格。这样同一个焦点在另一句话里再出现时，能认出是「又一次遇到」。

### 3.3 路由与守卫

新文件 `routes/expressions.ts`，挂在 `/api/expressions`。在 `app.ts` 里，全局守卫之后、路由挂载之前，加一道私有守卫：

```ts
// Second gate for private data. The global guard lets everything through when
// AUTH_TOKEN is unset (dev mode); private routes do the opposite and refuse to serve.
export const requirePrivate = createMiddleware(async (c, next) => {
  if (!process.env.AUTH_TOKEN) {
    return c.json({ error: "Set AUTH_TOKEN to use private routes", code: "AUTH_NOT_CONFIGURED" }, 503);
  }
  c.header("Cache-Control", "no-store");
  return authMiddleware(c, next);
});

app.use("/api/expressions/*", requirePrivate);
```

代价是本地开发也要设一个 `AUTH_TOKEN` 并登录，README 的环境变量一节要写明。路由文件里带参数的路径把数字约束写上（`/:id{[0-9]+}`），免得 `/find`、`/try` 这些静态路径被 `/:id` 吃掉；`cards.ts` 用的是另一种办法，把 `/missing-deep` 注册在 `/:id` 前面。

测试：不带 cookie 请求每一条表达路由都是 401；没设 `AUTH_TOKEN` 时是 503；响应带 `no-store`。

### 3.4 接口

全部在 `/api/expressions` 下，管理员专属。带星号的是 P2。

| 方法与路径 | 作用 | 写入 |
|---|---|---|
| GET `/` | 列表。P2 起「想用」层的条目不返回英文和补注 | 无 |
| POST `/` | 收。请求体：`text`（必填）、`focus`、`textBefore`、`sourceType`、`sourceTitle`、`sourceLocator`、`occurredAt`、`force` | 一行 expressions 加一行 met，同一个事务 |
| GET `/:id` | 详情和时间线 | 无 |
| PATCH `/:id` | 改 `note`、`focus`、`intent`、`status` | 状态变化不进时间线 |
| POST `/:id/encounters` | 又一次遇到 | 一行 met |
| POST `/:id/annotate` | 重试补注 | 回填 `gloss`、`ai_intent`、`next_scene` |
| POST `/:id/reveal` * | 揭晓 | 一行 reveal，同一个事务里读回原文 |
| POST `/find` * | 找 | 若干行 looked_up |
| POST `/pick` * | 帮我挑 | 无 |
| GET `/try` * | 至多 3 条可测的 | 无 |
| GET `/:id/scene` * | 遮住目标的原场景 | 无 |
| POST `/:id/attempts` * | 作答 | 一行 attempt，先落库后判定 |
| POST `/attempts/:encounterId/judge` * | 在同一行上重试判定 | 回填 |
| POST `/attempts/:encounterId/overturn` * | 推翻判定 | 回填 |
| GET `/stats` * | 首页的条数和冻结期的两个天数 | 无 |

「收」的要点：

- 先落库再返回，不等模型。唯一会被拒的是空的 `text`。
- 查重在应用层。同 `norm` 已有条目而请求没带 `force` 时，返回 409，带上已有条目的 id、原句和日期，界面让用户选「又一次遇到」（调 `/:id/encounters`）或「另存」（带 `force` 重发）。这不算拒存：文本还在输入框里，选完立刻落库。查重只能放在服务端，因为 P2 起「想用」层的条目不再把原文发给页面。
- 事务用现成的写法（`db.transaction`，见 cards.ts:111）。

### 3.5 补注

保存成功、响应发出之后，在进程里直接发起一次模型调用，不经过 `jobs` 表。成功则回填 `gloss`（至多三行）、`ai_intent`、`next_scene`；失败只记一行不含原文的日志。进程重启会丢掉进行中的那次，所以详情里放一个「补注」按钮手动重试。`ai_intent` 一旦写下就不再重新生成，重试时只补空着的字段，这是 01 的 M7 比较两类提示句通过率的前提。

界面上，刚收下的条目先显示「补注中」，隔几秒重取两三次；还没有就显示按钮。补注永远排在原文和用户自己的备注下面，标明是 AI 写的。

调用走 4.1 节的通道，prompt 形状见 4.2。P1 就要用到通道和第一个 prompt，所以这两节的相应部分在 P1 实现。

### 3.6 页面

一个新页面，管理员的首页。布局自上而下：

1. **输入框**，一排来源标签（AI 对话、书、影视、其他），两个按钮「收下」和「问」。「问」在 P1 先不出现。
2. **试一条**（P2）。
3. **列表**，可按层筛选，输入框下方的条目按时间倒序。

交互上要定的几件事：

- **来源标签**只在这一次停留里记住上一个选择，刷新即清。沿用下来的标签显示在框旁，点一下清掉。没选就是「未记录」。时间自动记，详情里可改。
- **选中即焦点。** 框里是一句话时，选中其中一段再点「收下」，选中的是焦点，整句是原文。框里是贴进来的一段多行对话时，选中的那一段是原文，它前面最近的一个非空段落自动填进上文，保存前可改；焦点可以之后在详情里再标。不选任何东西，整框就是原文。
- **预填。** 01 写的是「地址栏参数」，这里收紧成 `#` 片段，不用查询串：片段不会发给服务器，进不了任何一层的访问日志（1.5 节第 4 条）。约定 `/#text=…&focus=…`，页面加载时读一次、填进输入框、然后把片段清掉；**只预填，永不自动提交。** 词卡那边现成的 `?prefill=`（WordForgePage.tsx:8-24）是同样的「读一次就清」，照它的结构写，换成片段。书签脚本就是一行：把当前选中的文字拼到这个地址后面打开。
- **词卡详情上的「收」。** 在 `PrototypeWordCard` 里加一个只有管理员看得到的按钮，跳到 `/#focus=<这个词>`。不自动把查过的词收进来。
- **详情**用对话框，和词卡详情一个路数。内容：原文（焦点高亮）、备注、补注、出处和时间、时间线（每一行 encounters）。场景回看就是时间线上最早的那条 `met`，不请模型重建任何东西；没记的格子留空。
- **首页分流。** `/` 对管理员是表达页，对匿名访客重定向到 `/cards`。不要直接用 `useIsAdmin()` 来分：它在加载中返回 false，管理员每次硬刷新都会先被送去词卡页。分流组件要等登录状态的查询有了结果再决定。
- **导航**：管理员多一项「表达」，排第一。
- **登出**时把 `["expressions"]` 开头的查询从缓存里清掉。

列表在客户端过滤就行，库在很长时间里都只有几百条；服务端不接收检索词。

### P1 验收

1. 不联网模型也能收：断开模型配置，「收下」照样成功，只是没有补注。
2. 同一句收两次，第二次得到「又一次遇到 / 另存」的选择；两条路都走得通。
3. 匿名访客：首页落在词卡；任何表达接口 401；页面源码和网络面板里没有表达数据。
4. 查服务端日志：收一条带特殊标记的句子，日志里搜不到这个标记。
5. 在数据库副本上演练过迁移，线上部署前有拷出主机的备份。
6. 行数仍然低于 15,966。

## 4. P2　找、试一条、流水账

### 4.1 模型通道

现有代码里每个任务在两份 provider 里各写一遍。四个新 prompt 照这个写法会是八个函数。建议只加一对薄函数，四个任务共用：

- 在 `gemini.ts` 和 `openai-compat.ts` 里各加一个 `…Json(opts)`，照 `geminiExtractWords`（gemini.ts:459-499）和 `openaiExtractWords`（openai-compat.ts:429-469）的骨架：取信号量，`runWithModelFallback`，调模型，`parseJsonLenient`，返回 `unknown`。它们必须写在这两个文件里，因为 `getClient()` 和 `openaiChat()` 是模块私有的。
- 在 `ai-router.ts` 里加一个 `generateJson(route, { system, user, label })`。
- 四个任务写在一个新文件里（比如 `services/expressions-ai.ts`），各自拼 prompt、调 `generateJson`、用 zod 校验输出。

路由键用一个新的 `expressions`，在 AI Providers 页面上占掉 chunks 腾出来的位置。没配的时候沿用 cards 路由的：provider 取 `expressions_provider`，空着就取 `cards_provider`（`ai-shared.ts:28` 的 `getFirstSetting` 就是按顺序取第一个非空值）；模型键同理，在 `primaryKeys` 里把 cards 的键排在后面。免得上线当天还要去配一遍。

**超时要单独定。** 这几个调用是同步的：请求进来，等模型，回去。现有的默认是单次 60 秒、至多重试 3 次，而请求前面有 nginx 和 Cloudflare。仓库里的 `nginx.conf` 没有设 `proxy_read_timeout`，nginx 的默认值是 60 秒；线上那份配置不在仓库里，没有核过。所以这条通道只试一次，单次上限定在 45 秒左右，超时就按失败处理。用户的句子在调用之前已经落库，失败不丢东西。真实延迟从来没有量过，上线前先量。

### 4.2 四个 prompt 的输出形状

01 定了有四个 prompt 和各自的职责，形状是这里补的。四个都要求只返回一个 JSON 对象；用户的文本放在单独的数据区，指令里写明数据区的内容不是指令。

**补注。** 输入：原文、焦点、上文。

```
{ "gloss": string,     // 至多三行：这个说法在这句话里起什么作用、语域、一个常见搭配
  "aiIntent": string,  // 一句中文的意图，以「我想说……」开头，不出现目标表达的英文
  "scene": string }    // 两三句中文写的处境，不含目标表达，不是一句待翻译的话
```

**找。** 输入：这一轮的需求、可选的英文尝试、线程历史、整库索引。索引每行是 `id | 焦点（没有则截断的原文）| 提示句 | AI 写的意图`，三种状态的条目都进。

```
{ "mine":  [{ "id": number, "why": string }],        // 库里适用的
  "fix":   { "text": string, "why": string } | null,  // 只在用户附了英文时：改到能用的最小改动
  "fresh": [{ "text": string, "why": string }] }      // 至多 2 条新说法
```

**判定。** 输入：目标表达（原文与焦点）、出给用户的题面、用户写的那句英文。

```
{ "used": boolean,      // 用没用上目标表达；屈折变化和合理的变体算用上
  "conveyed": boolean,  // 意思是否传到
  "rewrites": [{ "from": string, "to": string, "why": string }],  // 至多 2 处最小改写
  "nextScene": string } // 下一条备用情境，要求同补注的 scene
```

三种反馈由前两个布尔值得出，不让模型自己选措辞：`used` 是「用上了」；没用上但 `conveyed` 是「绕开但说通了」；都不是则「没说通」。prompt 里要写明：正确的替代说法不是错误，不要为了凑数挑毛病。被删掉的 `PRACTICE_GRADE_PROMPT`（ai-prompts.ts:350-373）是这个 prompt 的前身，它的形状是 `{ overall, good[], improve[{ point, suggestion }], usedSuggestions[{ form, used }] }`，其中「引用学习者自己的原话」「不要编造错误」「suggestion 里必须有自然的英文」这几句约束值得照搬。

**帮我挑。** 输入：贴进来的一段对话。

```
{ "picks": [{ "text": string, "before": string | null, "why": string }] }  // 至多 3 条
```

优先挑 AI 对用户自己那句话的改写。服务端要检查每条 `text` 是不是输入里的原样子串，不是就丢掉。界面上默认全不勾。

### 4.3 找

请求体：`{ need, attempt?, history, turn, thread }`。`history` 由页面持有，每次带上起头那句需求加最近 5 轮，服务端不存会话。`turn` 是这条线程里的第几轮，`thread` 是起头那句的时间戳，两者都记进 `looked_up` 行的 `feedback`。01 的 M11 要数「有多少线程顶到历史上限」，没有 `thread` 数不出来。

处理顺序：

1. 需求是单个英文词而且有对应的词卡：不调模型，返回词卡链接，同时按字符串匹配库里 `norm` 相同的条目。照样落 `looked_up` 行。
2. 否则拼索引、调一次模型。索引超过字符预算时（设一个常量），先放「想用」层，再按时间从新到旧放「见过」层，放不下的不放，并在响应里如实报告这次搜了多少条、库里一共多少条。
3. 模型返回的 `id` 不在这次给出去的候选集里的，丢掉。剩下的回表取原文。模型写的任何句子都不能冒充库里的原句：`mine` 只认 id，原文一律来自数据库。
4. 落库：每个库内命中一行 `looked_up`，没有命中则一行、`expression_id` 为空。同一次提问的各行共用一个 `created_at`。
5. 遮挡（见 4.4），然后返回。

每个库内命中在响应里带上它是「用出过的」还是「存过没用出的」，由折叠结果里的 `promotions > 0` 得出。

AI 的说法（`fix` 和 `fresh`）旁边有「收」。点了才落库：`text` 是 AI 的那句，`source_type` 是 `find`，`met` 行带上当时的需求和尝试。没有命中只表示这次没找到，界面上不要写成「你还不会」。

### 4.4 两层、遮挡与揭晓

**进「想用」层**要有一句提示句，用用户自己的话。来源记在 `intent_by`：在「找」里把命中放进想用时，刚敲的需求自动带上，记 `find`；从贴进来的对话收的，用户自己那一句自动带上，记 `paste`；自己敲的记 `self`。`PATCH /:id` 把状态改成 `active` 时，没有 `intent` 就拒绝，同时写 `active_since`。

**上限 12。** 01 写的是「只数升档不满 3 次的条目」。折叠同时给出当前档位和累计升档次数，没退过档时两者相等；这里按当前档位数，因为上限管的是近期要反复测的量，退回 0 档的条目理应重新占一个名额。超出的照样是 `active`，只是暂时不出题：取档位不到 3 的条目里 `active_since` 最早的 12 条，加上所有档位 3 以上的，这是可以出题的集合。不建队列表。

**遮挡在服务端做。** 判断条件是 `status === "active"` 而且没有毕业（档位不到 5）。满足条件的条目，列表、详情、场景回看的接口只返回提示句、出处、日期和状态，`text`、`norm`、`focus`、`gloss`、`note` 都不返回；时间线只给每一行的 kind、时间、`cue`、`outcome`，不给任何原文；查重的 409 响应同样只给提示句和日期。这样做是为了在不给读路径埋点的前提下，让「作答前没看过答案」站得住。

「找」里的遮挡多一个条件：这次查询没有附英文。遮住的命中，`looked_up` 行的 `cue` 记 `masked`，模型给的理由 `why` 也不返回，因为它常常会把答案引出来。同一次响应里的 `fresh` 照常返回，由页面先收着，等用户揭晓或作答之后再显示：服务端不存会话，没有地方替页面留着。「找」的 prompt 里要写明新说法不得与库内命中重复。

**揭晓**是 `POST /:id/reveal`，请求体带 `cue`：在找、列表、详情里是 `masked`；在试一条里放弃时，是放弃时所在的那一级。服务端在一个事务里写 `reveal` 行并读回原文。

**帮我起草**不需要第五个 prompt：补注那次调用已经写下了 `ai_intent`，按钮做的只是把它填进提示句的输入框，并把 `intent_by` 记成 `ai`。按钮默认不显示。显示的条件在页面加载时现算：库里最早一条的时间距今满两周，「见过」不少于 20 条而「想用」不到 5 条；或者用户自己在设置里打开。开关用一个普通的设置项。

### 4.5 试一条

`GET /try` 返回至多 3 条：从 4.4 的可出题集合里取 `now >= dueAt` 的，按 `dueAt` 从早到晚。「再来一条」是带着这一屏已经出过的 id 再取一次。界面上不显示还有多少条到期。每条给 `id`、题面和这道题的起始级别：条目有 `next_scene` 就出它，级别 `none`；没有就出提示句，级别 `need`。`none` 级别下连提示句也不显示。

提示阶梯三级，用户可以逐级要：提示句（`need`）；遮住目标的原场景（`scene`），由 `GET /:id/scene` 给，是最早那条 `met` 的原文把焦点换成横线，没有焦点或者焦点不是原文的子串时这一级不提供；答案，等于放弃，走揭晓。

作答是 `POST /:id/attempts`，请求体 `{ text, cue, prompt }`。`cue` 是作答前看到的最高一级，由页面上报；服务端只做力所能及的校验，比如条目没有 `next_scene` 时不接受 `none`。这是单用户的工具，要防的是界面自己把级别记错，不是恶意客户端。处理：

1. 一个事务里写 `attempt` 行（`outcome` 空，`feedback` 是 `{ prompt, status: "pending" }`），并清掉用过的 `next_scene`。
2. 调判定。
3. 成功：`outcome` 记 `used ? "pass" : "fail"`，`feedback` 补上 `status: "done"`、`used`、`conveyed`、`rewrites`、`judgedAt`；把 `nextScene` 写回条目。
4. 失败：`feedback.status` 记 `failed`，`outcome` 仍为空。响应告诉页面判定没成，页面提供重试，调 `/attempts/:encounterId/judge`。失败的作答不计次、不判错；因为备用情境已经用掉，下一次自然会用提示句出题。

响应里要不要带答案，看这一格：只给了新情境而且没用上（`none` 加 `fail`）时不亮答案，返回提示句，让用户带着 `need` 再试一次；其余情况返回原文和补注。

推翻是 `POST /attempts/:encounterId/overturn`：把 `outcome` 改成用户的判断，`feedback` 里记 `overturned: true` 和模型原来的结论。折叠只读 `outcome`。推翻率由这个标记算。

在「找」里对着遮住的命中先试写，走的是同一个接口，`cue` 是 `need`，题面是用户刚敲的需求。

### 4.6 折叠函数

档位和到期时间不存，每次从时间线算。下面是参考实现，2026-11-24 用 Node 跑过 18 个用例，全部通过。移植成 TypeScript 时把用例一起移植成 vitest。常数都在函数里，改了不用迁移。

```js
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// Lower bound (days) before the k-th promotion; five promotions, then graduated (study-engine.js:4).
const INTERVAL_DAYS = [1, 3, 7, 14, 30];
const GRADUATED = INTERVAL_DAYS.length;

/**
 * @param rows        one expression's encounters, any order:
 *                    { id, kind, cue, outcome, createdAt, judgedAt? }  (judgedAt comes from feedback)
 * @param activeSince expressions.active_since (ms); null while the entry is in the "seen" layer
 */
export function foldTimeline(rows, activeSince) {
  let level = 0;
  let promotions = 0; // passes that counted; "用出过" means promotions > 0
  let earliestAt = -Infinity; // set by the last promotion / demotion
  let answerSeenAt = -Infinity; // last moment the English was on screen
  const seen = (t) => {
    if (t > answerSeenAt) answerSeenAt = t;
  };
  const dropTo = (next, t) => {
    level = next;
    earliestAt = t + DAY;
  };
  // (Re)entering the "想用" layer restarts the 24h clock, but only for attempts made after it:
  // leaving and re-entering is not on the timeline, so older attempts keep the verdict they earned.
  const dueFor = (t) =>
    Math.max(earliestAt, answerSeenAt + DAY, activeSince != null && t >= activeSince ? activeSince + INTERVAL_DAYS[0] * DAY : -Infinity);

  const ordered = [...rows].sort((a, b) => a.createdAt - b.createdAt || a.id - b.id);
  for (const r of ordered) {
    const t = r.createdAt;
    if (r.kind === "met" || r.kind === "used") {
      seen(t);
      continue;
    }
    if (r.kind === "looked_up") {
      if (r.cue !== "masked") seen(t);
      continue;
    }
    if (r.kind === "reveal") {
      if (r.cue !== "masked") dropTo(0, t); // gave up inside 试一条 (cue = the level they were at)
      seen(t);
      continue;
    }
    if (r.kind !== "attempt" || r.outcome == null) continue; // not judged yet: no effect at all
    const pass = r.outcome === "pass";
    if (r.cue === "none" || r.cue === "need") {
      if (pass) {
        if (level < GRADUATED && t >= dueFor(t)) {
          level += 1;
          promotions += 1;
          earliestAt = level < GRADUATED ? t + INTERVAL_DAYS[level] * DAY : Infinity;
        }
        // a pass that came too early is kept on the timeline and changes nothing
      } else if (r.cue === "need") {
        dropTo(0, t);
      }
      // none + fail: recorded, neutral
    } else if (r.cue === "scene") {
      dropTo(pass ? Math.max(0, level - 1) : 0, t);
    }
    // cue "revealed": no level change either way.
    // The answer is shown after every judgement except none+fail; the moment is when the judgement came back.
    if (!(r.cue === "none" && !pass)) seen(r.judgedAt ?? t);
  }

  const graduated = level >= GRADUATED;
  const dueAt = graduated || activeSince == null ? Infinity : Math.max(earliestAt, answerSeenAt + DAY, activeSince + INTERVAL_DAYS[0] * DAY);
  return { level, promotions, graduated, dueAt, answerSeenAt };
}
```

它实现的是 01 的 M9 那张表，加上三条 M9 没写到的补全：

- 退回「见过」再放回「想用」，已经挣到的档位保留，24 小时从重新放回的那一刻起算，只约束那之后的作答。原因是状态变化不在时间线上，旧的作答没法按当时的激活时间重判。
- `used` 行按「看到了答案」处理。这种行冻结期之后才会有，到时候再定它算不算证据。
- 毕业之后不做特殊保护。界面上毕业的条目不出题、不遮挡，产生不了会让它降档的作答。

通过的 18 个用例，移植时一个都不要少：

| # | 用例 |
|---|---|
| a | 新放进想用的条目，24 小时后才可测 |
| b | 23:59 答对，00:02 再答对：第二次不升档 |
| c | 在找里揭晓之后 24 小时内答对：照记，不升档 |
| d | 只给新情境而没用上：档位、到期时间、「上次看到答案」都不变 |
| e | 看了提示句仍没用上：归零，24 小时后可再测；`promotions` 不清零 |
| f | 看了原场景才用上：退一档，不低于 0；看了仍没用上：归零 |
| g | 在试一条里放弃并揭晓：归零。在找、列表、详情里揭晓：档位不动，到期时间顺延 24 小时 |
| h | 还没判定的作答：对任何东西都没有影响 |
| i | 推翻判定：同一行换了 `outcome`，结果随之变 |
| j | 正好踩着 1、3、7、14、30 天各答对一次：5 档，毕业 |
| k | 间隔按实际经过的时间算：差一小时不升档，而且这次提前的作答会把到期时间再推 24 小时 |
| l | 退档之后再答对，回到正常的阶梯 |
| m | 退回见过再放回想用：档位保留；重新放回后 24 小时内的作答不升档，满 24 小时的升 |
| n | 看着答案作答：对错都不动档位 |
| o | 遮着给的命中不重置 24 小时；没遮的命中重置 |
| p | 「看到答案」的时刻取判定返回的时间，不取作答落库的时间 |
| q | 「见过」层的条目永远不到期 |
| r | 输入行的顺序不影响结果 |

### 4.7 流水账与首页的数

外置脑的第一版就是时间线本身。详情里每一行都看得到，每个结论都点得回原始行。

首页只显示一个数：`promotions > 0` 的条目有几条。按折叠的规则，这正好是「隔了一天以上、作答前没看答案、在新句子里打出来过」的条目数。不显示库有多大，不显示比率和进度条。如果用户在 U7 上选了「直接显示、不遮」，这个数的说明文字里就不能再写「作答前没看答案」。

`GET /stats` 把所有条目和时间线读出来在内存里算，库小，不需要任何缓存或汇总表。

### 4.8 两份评测

两份都是固定的输入集加一个手动运行的脚本，会真的调用模型，由管理员在本机跑。评测集放仓库外面。

**召回。** 30 条真实的需求（用户自己写，或者从随手记里那些「当时想说而说不出」的条目反推），每条标注库里应该命中哪几条。带和不带 chunks 各跑一遍。它是引入 FTS5 或 embedding 的唯一闸门，也是 chunks 进不进索引的依据。

**判定。** 20 句左右已知对错的句子。用用户自己的打底：`Larry语法课程\语法测试追踪.md` 的 :244-260 有 17 句，标注先请用户过一眼；再补几句「对但不寻常」的，专门量把对的判成错的比例。它是判定结果能不能记账的闸门：误判率高，就按 01 的 M4 只存句子、不记对错。

### P2 验收

1. 折叠的 18 个用例通过。
2. 遮挡：把一条放进想用之后，列表、详情、时间线、找的响应体里都搜不到它的英文；揭晓之后时间线上多一行 `reveal`。
3. 找：模型返回一个不存在的 id 时被丢掉（用 mock 测）；没有命中时落一行 `expression_id` 为空的 `looked_up`；一次提问的多行共用 `created_at`。
4. 试一条：模型调用失败时，作答那一行还在、`outcome` 为空、可以重试；重试成功后是回填在同一行上。
5. 两份评测跑过一遍，结果给用户看过。
6. 量过「找」和「判定」的真实延迟，同步调用在超时之内。
7. 行数：P1 加 P2 新增不超过约 2,000 行，总数低于 15,966。

## 5. 冻结期与读数

上线后 4 周功能冻结：只许用和修 bug，删除不算功能，预先做好的开关不算破冻结。4 周后按下面的读数决定，规则全在 01 的 M4，这里只说怎么算。

日期按一个固定的时区分桶（UTC+8，写成常量）。只靠时间线算，不加任何埋点。

- **可测日**：那一天有过从表达页发起的写入（`met`、`looked_up`、`attempt` 行；`reveal` 不算），并且在其中某一次写入的时刻，按折叠至少有一条可测。判断「那一刻有没有可测的」，是对每条 `active` 的条目把时间线截到那一刻再折叠，用的是条目现在的状态和 `active_since`。01 接受了这个近似带来的偏差。
- **有作答的可测日**：可测日里有 `attempt` 行的。
- 表达页上只摆这两个天数和判定日期。不做成连续天数，不做成得分。

| 读数 | 结论 |
|---|---|
| 可测日不足 4 天 | 没在用。不做后续，也不据此拆 |
| 可测日够 4 天，有作答的不到一半 | 移除提取界面，产品如实叫「带语境的查词本」，不显示掌握数字；给「想用」层一次 Markdown 导出 |
| 判定被推翻超过三成 | 只存句子，不记对错 |
| 遮住的命中里先试写的不到两成 | 改为直接显示 |
| `none` 与 `need` 两级的通过率没有差别 | 不再区分 |
| 起草类提示句的通过率明显更低 | 撤掉「帮我起草」，这些条目退回「见过」 |

## 6. P3

只在第 5 节判为在用时才做，每一项有自己的准入条件，都写在 01 里：

- 两份 provider 实现的折叠、`settingsTest.ts` 的重写（M1 第 6 条）。任务类型删完之后再做，现在做是在重构即将删除的代码。
- 「先试试，你有这些零件」：只用有产出记录的条目拼候选草案（M10）。
- 独立对话页（M11，三个准入条件任一）。
- 一个手动、单向、整份覆盖、永不读回的 Markdown 导出；粘贴外部对话时顺带检出用到的库内条目，写 `used` 行（M12）。
- chunks 作为第二候选池加回「找」：用户明说要，或者召回评测里带上它明显更好（M1）。

## 7. 这里补全而 01 没写的

| # | 补全 | 位置 | 依据 |
|---|---|---|---|
| 1 | P0 内部的七步顺序，步骤 0 先止血 | 2 | 01 的 1.4：停在任何一步都要完整 |
| 2 | 默认拒绝的守卫的具体写法和公开清单 | 步骤 5 | M1 第 3 条 |
| 3 | 设置页对匿名只留主题、缓存和 About，而不是整页设防 | 步骤 5 | 移动端没有别的主题入口 |
| 4 | `schema.ts` 里保留三张旧表的定义 | 1.4 | drizzle-kit 的生成方式 |
| 5 | P1 只有「见过」层，「想用」层随 P2 出现 | 3 | M2：P1、P2 连续交付，中间不试用 |
| 6 | 每种 kind 的各列放什么；`source_type` 的取值；`reveal` 行的 `text` 是空串 | 3.2 | M5 |
| 7 | `norm` 取焦点优先 | 3.2 | M6「同 norm 已存在」 |
| 8 | 私有守卫没设 token 时回 503；数字约束的路径参数 | 3.3 | M1 第 3 条 |
| 9 | 接口清单；查重用 409 | 3.4 | M6 |
| 10 | 补注不经过 jobs 表，进程内发起，手动重试 | 3.5 | M1 第 3 条、M6 |
| 11 | 选中即焦点的两种情形；首页分流的写法 | 3.6 | M6、M11 |
| 12 | 预填用 `#` 片段 | 1.5、3.6 | logger 记查询串；M1「私人数据不进……」的同一个意思 |
| 13 | 一对薄的 JSON 通道函数；新路由键 `expressions`；同步调用单次 45 秒不重试 | 4.1 | 预算；反代超时 |
| 14 | 四个 prompt 的输出形状；反馈措辞由两个布尔值得出；帮我挑的子串校验 | 4.2 | M6、M8、M9 |
| 15 | `feedback` 里加 `thread`；单词查询顺带按 `norm` 匹配库内条目 | 4.3 | M11 的准入条件要数线程；M6「单词与表达是同一种记录」 |
| 16 | 遮住的命中不返回模型的理由；`fresh` 由页面先收着；遮挡的字段清单（含 `note`、`norm` 和查重的响应） | 4.4 | M7、M8 |
| 17 | 排队不建表，从 `active_since` 和档位现算；上限按当前档位数，不按累计升档次数 | 4.4 | M5「不设队列表」、M7 |
| 18 | 「帮我起草」复用 `ai_intent`，不加 prompt | 4.4 | M7、prompt 至多 4 个 |
| 19 | `cue` 由页面上报；原场景这一级由单独的读接口给 | 4.5 | M9 |
| 20 | 折叠函数的三条补全（重新放回、`used` 行、毕业之后） | 4.6 | M9、M4 的偏差说明 |
| 21 | 读数按 UTC+8 分桶；`reveal` 不算写入 | 5 | M4 |

## 8. 风险与没验证的

- **没有发起过一次模型调用。** 延迟、费用、判定的准确率、整库索引进 prompt 之后找得准不准，全是推测。4.8 的两份评测和 P2 验收的第 6 条就是为这个设的，别跳过。
- **同步调用可能撞上反代的超时。** 线上 nginx 的配置没有核过。
- **预算是估的。** P0 能删到多少、P1 加 P2 的 2,000 行够不够，都没有实测。超了先砍功能，不要放宽预算。
- **判定是整个证据链的地基。** 模型把对的判成错的，用户推翻几次之后就不会再信这个数。推翻率超过三成的出路已经写好，但更可能的情形是用户懒得推翻，直接不用了。评测集里那几句「对但不寻常」的要认真挑。
- **库从空的开始。** 不写导入器是有意的，代价是头几周「找」几乎找不到东西。01 建议的种子是 AI 对用户自己句子的改写，和语法测试追踪里那 16 条待巩固。
- **最大的风险不在代码里。** 这个站点八个月里有 62 天有人来，用的是词卡。表达库会不会被用起来，取决于用户以后是不是先把表达记在这里（U10 的默认是不动现状）。第 5 节的读数就是为了在 4 周后诚实地回答这个问题。
