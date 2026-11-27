# WordLoom

一座公开可读的英语词卡库。任何人都能搜索、翻阅词卡；词卡由管理员用 AI 生成，一张卡上分层写着音标、词源、认知意象、家族对比和边界测试。

管理员另有自己的表达库和对谈页：连原句收下表达，与英语伙伴讨论自己的想法，随时收下对话里的说法，再隔些天自己用出来。访客看不到它们，也读不到它们的接口。

## 功能

**Word Forge** — 词卡库：谁都能查，管理员能造

所有人，不用登录：

- **搜索**：一个搜索框，输入即过滤，按输入内容决定搜哪一列
  - 含中文 → 只匹配释义（coreMeaning）
  - 单个英文单词 → 只匹配单词（word）
  - 其余（多词短语等）→ 单词和释义都匹配
- **相关性排序**：搜索结果按 `精确匹配 > 前缀匹配 > 子串匹配 > 仅释义命中` 排序，再叠加 usageCount 和 createdAt——输入 `set` 时 `setup` 排前面，`asset/closet` 排后面，永远找得到精确那张（usageCount 是旧版留下的使用计数，现在没有入口再累加）
- **浏览**：CEFR 等级筛选（A1–C2），每页 20 张；不搜索时新卡在前。搜索、级别、页码和阅读位置在当前浏览会话里保留，切到设置再回来可以继续读
- **读词卡**：点开任意一张，详情地址带 `?card=<id>`，浏览器返回先关闭详情。词卡和级别筛选可以用键盘操作，关闭后焦点回到原入口；直接打开详情链接也能返回词库

管理员登录后多出：

- **查/造合一**：还是那个搜索框——输入的单词在词库里没有精确匹配时，出现"生成词卡"，回车即可生成
- **三种生成入口**：输入一个单词、一次输入多个（逗号/空格分隔，最多 10 个）、粘贴文本由 AI 抽取生词后勾选
- **重复检测**：已有单词不再调用 AI 重新生成，直接返回已有卡片
- **卡片生成走异步 Job 队列**，状态由服务端权威返回（queued/running/done/failed/cancelled），可以取消
- **深度分析手动触发**：新卡只有基础层。在词卡里点"生成深度分析"，或用列表上方的 Retry Deep (N) 给所有缺的卡批量补；生成后存库，再打开不会重复调用 AI
- **删除词卡**

词卡结构：

- **卡头** — 单词、音标、词性与 CEFR 等级。卡头之后先读核心意象，不额外插入中文释义、例句预览或评分信息
- **核心意象 (Core Image)** 用一个场景讲清一个用法，配一句同场景英文。种子词卡中，grim 画读报告时的神情，resume 画午休前后接续的讨论，spontaneous 用文字写演讲结束时响起的掌声。新生成的意象按需配图，其他旧卡沿用已有图解。模型 SVG 通过 `<img>` 隔离显示。打开单张词卡或一条表达时，浅色详情使用燕麦色卡底与墨青色重点标记，并适配深色模式
- **词根词源 (Etymology)** — 词源说明；有深度分析时附语义演化链条（Evolution Chain）
- **边界测试 (Boundary Tests)** — 一次一题，选项打乱，先选择再显示参考判断和解释；支持重试、下一题和完成后统计第一次答对的题数。旧格式情境题按适用性选择。这是词卡自检，不写入表达库练习记录
- **家族对比 (Family Comparison)** — 可折叠，按区分轴、怎么选、逐对边界和对比表阅读。第一次答题揭晓后自动展开，没有测试题的卡直接展开。桌面保留四列表，手机直接显示核心区别、语域和场景；家族里的其他词可点，关闭详情并填入词库搜索框
- **我收过的原句**（仅管理员）— 默认折叠，展开才从表达库读取相关原文。完整单词和已知名词、动词的常规词形可匹配，不猜不规则变化；同一句的不同焦点收藏去重，优先链接焦点包含当前词的记录。先看三条，再分批展开；突出命中词并显示出处和日期。点击后打开 `/?expression=<id>`，关闭返回原词卡。已收起或练习中遮挡的原文不显示，读取不调用模型、不计为练习
- **搭配与例句** — 默认折叠，展示去重后的搭配与短语、三句分级例句和译文，以及易混词与反义词
- **场景激活 (Frame Activation)** — 可折叠，展示不同领域的情景描述、例句与关联词群

释义用于列表摘要，WAD/WAP 与旧语境阶梯等字段继续兼容已有数据，但不铺在详情顶部。新生成内容先按词类决定辨析维度和是否需要画图；搭配与短语合并生成，不再重复要求语境阶梯、近义词、隐喻扩展和总语域说明。区分轴与选择规则仅在有相应数据时显示，旧卡不会自动迁移或重新生成。

**表达库** — 只属于管理员：收下、问回来、试着用出来

管理员的首页就是它（访客的首页是词卡）。输入框用来收下原句或从一段对话里挑选：

- **收**：贴一句话或一段对话，点"收下"。原文逐字保存，先落库再返回，不等模型
  - 选中即焦点：一句话里选中的那几个词是焦点；一段对话里选中的那一段是原文，它前面最近的一段自动带作上文（可改）
  - 来源标签：AI 对话 / 书 / 影视 / 其他，只在这一次停留里记住上一个选择
  - 同一个说法再收一次，会问是"又一次遇到"还是"另存"为另一个意思
  - 存下之后在后台请模型补一条注（至多三行，标明是 AI 写的）；没补上可以在详情里点"补注"重试
- **帮我挑**：框里是一段对话时出现。让模型挑出至多 3 句值得收的，每一句都必须是原文里逐字出现的，默认一条都不勾。勾了收下时，库里已经有同样说法的那一句不会直接存，照样在它下面问是"又一次遇到"还是"另存"

列表分为全部、想用、见过和已收起；全部不含已收起。每页 20 条，先在浏览器里筛选再分页，私人搜索词不进入 URL。搜索或切换分栏回第一页，翻页回到列表开头；归档导致最后一页消失时保留有效页码。切到其他页面再回来，筛选、分栏、页码与阅读位置仍在；刷新和退出登录后清掉这些临时阅读状态。

在详情中选中原句的一段文字，点「写批注」就能记下自己的理解，也可以附一组对照例句。一句可以标多处。点带下划线的片段，桌面在右侧显示对应批注，手机在原句下方显示。「回想与练习」里可以选一处作为练习焦点。需要回想的条目在揭晓后才显示原句和批注。

详情底部可以收起、恢复或永久删除。永久删除需要确认，会同时删除该表达的批注和学习记录，并刷新列表、词卡关联与统计；失败时保留原记录和未保存内容。对谈文本保留，已删除表达的命中引用不再显示。

收下的条目分两层：

- **见过**：默认的一层，随时看得到原文
- **想用**：写一句自己的提示句（"我想说……"）才放得进去。列表、详情、时间线和中文对谈的命中里都先遮住英文；点"看答案"会记在时间线上，命中也可以先试写一句。英文对谈已经作出尝试，匹配的说法会直接显示。档位不到 3 的条目同时出题的至多 12 条，多出来的排队

**试一条**在输入框下面：到时间的"想用"条目每次至多出 3 条，给一个新情境（没有备用情境时给你的提示句），让你用一句英文说出来。

- 提示逐级要：提示句 → 遮住目标的原场景 → 答案（等于放弃）
- 模型只判三种："用上了" / "绕开但说通了" / "没说通"，并给至多两处最小改写；判错了可以推翻，算数的是你的结论
- 隔 1、3、7、14、30 天各用出一次就毕业。看过答案之后 24 小时内的作答照记，不升档
- 档位和到期时间都不存库，每次从时间线现算；学习记录不单独删除，永久删除表达时整条时间线一起删除，详情展开学习记录后可查看
- 没有到期条目时，可从见过选一条，直接填写自己的提示句；放进想用紧邻提示句，备注、出处和学习记录随后展开。这个入口不绕过隔天练习规则

学习统计保留用出过几条、可测几天、其中作答几天和判定日期，计数条件可展开查看。列表分页另显示当前筛选范围的条数和页码，不把收藏量当作掌握量；没有进度条或连续天数。

词卡详情上有"收"（只有管理员看得到）；地址 `/#text=…&focus=…` 会预填输入框——只预填，不提交，并且用的是 `#` 片段而不是查询串，所以不会进任何访问日志。详情里的我收过的原句可以直接打开已有表达记录，链接只携带数字 id，原文和私人筛选词不进入 URL。

**对谈** — 独立的沉浸式英语伙伴，地址 `/talk`

- 用中文、英文或混合语言说自己的想法，对方以自然的英语回应，回复逐段显示
- 重点纠正、整句说法和可收下的表达位于回复后的学习反馈区；回复前的查看学习反馈可直接跳到它。相同改法会去重，点"收"才加入表达库
- 每轮检索自己的库，命中分"用出过的"和"存过没用出的"；遮挡由服务端统一处理，回看旧对话也按当前状态遮挡
- 聊天保存在服务器上，支持继续、切换和整场删除。完整回复先保存，批注失败可以重试，不会丢掉回复
- 偶尔把到期表达编成回顾情景，下一句英文走原有的判定和时间线；中文继续聊天不计失败
- 每条回复前的工具栏提供听语音与学习反馈入口。Rime 朗读点击才开始，可以停止；在 AI Providers 配置密钥、声音和倍速
- 新对话可填入一个开场例子，例子只填输入框，不自动发送

**语言设置**

设置页的「界面语言」可在简体中文和英语之间立即切换，导航、词卡、表达、对谈、登录和通知都会跟随，刷新后保留选择。访客也能切换，偏好只保存在本浏览器。

「AI 解释语言」单独控制新生成词卡的释义、词源和深度分析，可选中文、英语或双语。切换界面不会改写已有词卡、原文、对谈内容或未保存的设置。

**移动端适配**

- 桌面与手机共用 Radix Dialog 的焦点与滚动锁定；手机以全屏呈现
- 词卡按内容正常滚动，折叠区不被固定视口挤压；近义词改为易读的卡片
- 图内标签按实际容器缩放补偿字号，七张验收样本在 390px 手机上均不小于 14px
- 关闭按钮跟随滚动，浏览器返回同样可以关闭详情

**主题**

- 亮色：默认 shadcn/ui
- 暗色：基于 Solarized Dark，主站、词卡与图解共用表面和文字颜色；调整阅读文字与控件配色的对比度。具体色值以 `src/client/index.css` 为准

**已移除**

- Story Studio、Chunk Forge、旧练习、图片生成和原有 TTS 流程已删除。`stories` / `practices` / `chunks` 三张表和里面的数据原样留在库里，应用不再读写；对谈朗读使用新的 Rime 接口
- 语块可以导出成一份 Markdown（只读，不改数据库）：`node tools/export-chunks.mjs <app.db 路径> <输出.md>`

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 19, Vite, Tailwind CSS v4, shadcn/ui, TanStack Query |
| 后端 | Hono (TypeScript), Node.js |
| 数据库 | SQLite (Drizzle ORM + libSQL) |
| AI | 双 Provider：Gemini API + OpenAI-compatible（DeepSeek / GLM / Grok / Kimi 等中转站） |
| 部署 | systemd + 宿主机 nginx（可选 Docker） |
| PWA | vite-plugin-pwa。设置页可主动更新，公开词卡列表与已打开的详情支持离线阅读 |

## 快速开始

如需使用仓库附带的词库，请先按下方“导入已有词库”说明处理。下载种子压缩包不会自动导入数据。

```bash
# 安装依赖
pnpm install

# 启动开发服务器（前后端同时启动）
pnpm dev
```

浏览器访问 `http://localhost:5173`，进入 AI Providers 页面配置连接和模型。

开发后端使用 Node 自带的文件监视配合 tsx 加载 TypeScript，绕开 Windows 上并行启动 `tsx watch` 时复现的启动卡住问题。

### 导入已有词库（可选）

运行中的数据库不在 Git 里。`seed/wordloom-seed.db.gz` 是可选的初始数据，包含 3,380 张词卡、301 条语块和维护者明确授权公开的 40 条笔记表达；不含模型配置、API key、登录会话、对谈、故事或练习流水。在**首次启动前**解压到 `data/app.db` 即可：

已有本地数据库时不要直接覆盖 `data/app.db`，否则会丢失现有配置和学习记录。

```bash
gunzip -c seed/wordloom-seed.db.gz > data/app.db
```

Windows（PowerShell）没有 `gunzip` 时可用 7-Zip 解压后改名为 `data/app.db`。导入后仍需在 AI Providers 页面填写自己的 API key。这是某一时刻的快照，不会随线上数据自动更新。

表达的原文、焦点、提示句、释义、笔记和来源标签也以可直接查看的 [JSON](seed/expressions.json) 保存；字段与初始化方式见 [种子数据说明](seed/README.md)。表达保留一条已收起记录，初始列表显示 39 条；没有用出、毕业或实际练习记录。已有数据库不要用压缩包覆盖，应用内删除也不会自动改写这份静态快照。

## AI 服务配置

应用内分为两个配置页面：

### AI Providers（`/providers`）— 需要登录

管理 AI 连接、模型探测和路由分配。此页面需要管理员登录才能访问。

- **双 Provider 支持**：Gemini（官方或中转站）+ OpenAI-compatible（DeepSeek / GLM / Grok / Kimi 等），各自独立的 API Key 和 Base URL
- **Detect & Verify** 每次最多验证服务端列出的前 10 个模型，最多同时发出 5 个请求。结果显示其中实际通过验证的模型数。
- **Model Routing**：Cards / Deep / Utility 三条路由，每条可独立选择 provider + primary model + fallback model；第四条 Expressions 给表达库和对谈用（补注、对谈、判定、帮我挑），留空的项沿用 Cards 路由，没有 fallback model
- **Test Routes**：每条路由可单独 ⚡ 测试，也可 Test All Routes；Cards / Deep 检查返回的 JSON 结构，Utility 检查能否返回文本，Expressions 没有自己的探测，按 Cards 的方式测它那一行的 provider 和模型
- **测试状态** 路由显示未测试、可用或失败。已保存配置的版本与探测时一致时，本标签页刷新会恢复结果和延迟。编辑配置后需要重新验证，失败详情在本次探测中显示。
- **API Key 只写不读** 页面只显示密钥是否已配置。同一服务来源留空可沿用旧密钥，更换协议、主机或端口时需为新来源填写密钥。一次保存的配置变更在同一事务内生效。
- **Rime 朗读**：设置 API key、Coda / Mist、声音和倍速，只在对谈点击"听语音"时调用

### Settings（`/settings`）— 公开，管理员多三项

页面任何人可访问。存在浏览器里的偏好谁都能改；存在服务端的设置只有管理员看得到、改得了。

- **Appearance**：亮色 / 暗色 / 跟随系统
- **App Refresh & Cache**：强制刷新 PWA、清理本地缓存
- **Account**：管理员登录 / 退出登录（手机上没有侧边栏，这里是唯一的入口）
- **Interface Language**（所有人）：简体中文 / English，立即更新本浏览器界面并保留偏好
- **AI Explanation Language**（管理员）：新生成解释性文本的语言（简体中文 / English / Bilingual），不改写已有内容
- **Network Tolerance**（管理员）：可调 `api_timeout_ms`（默认 60s，deep 路由自动 ×2）和 `api_max_retries`（默认 3）
- **表达：帮我起草**（管理员）：在提示句旁放一个按钮，填进 AI 写的那句意思；条目还没有这一句时（补注没回来，或者那句话漏了答案被丢掉了），点它会再补注一次。默认关着，库满两周、"见过"不少于 20 条而"想用"不到 5 条时自己打开；勾上就现在打开

### 容错机制

- **Per-route timeout 倍率**：Deep ×2，适配长输出
- **智能重试**：仅重试暂态错误（502/503/timeout/rate limit），配额超限（RPD/TPD/quota）和认证错误立即失败
- **Model fallback**：primary 失败后自动尝试 fallback model
- **日志可追溯**：retry 和 fallback 切换均打印具体错误原因
- **表达库的调用是例外**：补注、挑选和判定每次只试一次，最多等 45 秒，不换模型。对谈分回复和批注两阶段，共享 45 秒时限，5 秒内的暂态失败可自动重试一次，已有文字输出后不重试；配额和认证错误直接失败。Network Tolerance 的设置不影响这些调用。完整回复会保存，批注和判定失败都可以重试

### 权限与安全

- **默认拒绝**：`/api/*` 下除白名单外一律需要管理员会话，否则 401。白名单只有读词卡（`GET /api/cards`、`GET /api/cards/:id`）、登录 / 退出 / 查询登录状态、健康检查，清单在 `src/server/middleware/guard.ts`。新加的路由不进清单就是私有的
- **访客只读**：搜索、翻页、看词卡不用登录；生成、抽词、深度分析、删除、任务队列、所有设置和整座表达库都是管理员的
- **表达库是私人数据**，在默认拒绝之外再过一道守卫（`/api/expressions/*`）：
  - 没设 `AUTH_TOKEN` 时默认返回 503。本机开发试用可设置 `EXPRESSIONS_OPEN_LOCALLY=1`，条件见下方环境变量。
  - 私人响应带 `Cache-Control: no-store`。退出登录会同时关闭其他已打开标签页的私人页面，并清除表达数据和探测缓存。
  - 运行时新增的原文、提问和作答只走请求体，不进查询串、服务端日志、报错信息或 `jobs` / `settings` 表，也不会自动导出到 `seed/`。仓库中的 40 条笔记表达是维护者明确授权的静态内容，用户自己的对谈和练习流水不包含在内
  - 它们是不可信文本：进 prompt 时放在数据区，模型没有工具、发起不了写入，模型写回来的内容一律按纯文本显示
  - **会发给模型的**（经过你自己配的 provider 或中转站）：收下的原文和上文（补注）；对谈的消息、服务端取出的历史和表达索引（想用目标的英文先遮挡）；点"帮我挑"时框里的整段对话；练习的题面、作答和目标表达。点"听语音"时，当前可见的回复发给 Rime，密钥留在服务端
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
- 页面用 `POST /api/cards/:id/deep?async=1` 生成深度分析。已有内容直接返回词卡，进行中的同卡请求共享任务 ID。旧客户端可同步等待同一任务。取消批次会停止该批次创建的子任务。

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
| Expressions Model | 表达库与对谈的模型，没有备用模型 | 空（沿用 Cards 的 provider 和模型） |
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
│   │   ├── expressions/    # 表达库与对谈（收 / 帮我挑、流式聊天、朗读、回顾、时间线）
│   │   ├── settings/       # SettingsPage + AIProvidersPage + SettingWidgets
│   │   ├── layout/         # 导航壳（5 tab: 表达/对谈/Cards/AI/Settings）、任务面板、错误边界
│   │   ├── auth/           # 登录页、AuthGuard、AdminOnly
│   │   └── ui/             # shadcn/ui 组件
│   ├── hooks/              # TanStack Query hooks 与 useReadingPosition（阅读位置恢复）
│   ├── lib/                # API 客户端、SVG 转图片、工具函数
│   └── store/              # Zustand（任务队列、主题）
├── server/                 # Hono 后端
│   ├── index.ts            # 进程入口：生产环境缺 AUTH_TOKEN / AUTH_SECRET 时拒绝启动
│   ├── app.ts              # 中间件顺序 + 路由装配（测试直接 import，不占端口）
│   ├── routes/             # API 路由（auth, cards, settings, settingsTest, jobs, expressions）
│   ├── services/
│   │   ├── ai-router.ts    # Provider 分发（读 {route}_provider 设置）
│   │   ├── ai-shared.ts    # Retry/timeout/settings/semaphore/fallback
│   │   ├── ai-prompts.ts   # Prompt 常量 + 语言指令（cards / deep）
│   │   ├── ai-normalize.ts # JSON 解析 + schema drift 容错
│   │   ├── gemini.ts       # Gemini SDK 调用
│   │   ├── openai-compat.ts # OpenAI-compatible raw fetch 调用
│   │   ├── expressions-view.ts # 表达库唯一的读路径：折叠、遮挡、出给页面的形状
│   │   ├── expressions-fold.ts # 从时间线算档位和到期时间（纯函数）
│   │   ├── expressions-talk.ts # 对谈：索引、遮挡、流式回复、存储与批注重试
│   │   ├── expressions-review.ts # 到期回顾选择和下一句作答
│   │   ├── expressions-speech.ts # Rime 朗读与长回复分段
│   │   ├── expressions-try.ts  # 试一条：出题、作答、判定回填、推翻、页面上的数
│   │   ├── expressions-ai.ts   # 补注、对谈回复与批注、判定、帮我挑
│   │   ├── jobs.ts         # 异步任务（建任务、状态流转、启动时清理孤儿任务）
│   │   └── semaphore.ts    # AI 调用的并发上限
│   ├── middleware/         # guard（/api 默认拒绝 + 公开白名单 + 表达库的私有守卫）、auth（httpOnly cookie + HMAC session）、rateLimit
│   └── db/                 # Drizzle schema + 连接；保留旧表，表达与对谈使用 expressions / encounters / talk_turns
└── shared/                 # 共享类型、校验、默认值与 SSE 解析（expressions.ts / sse.ts 等）

drizzle/                    # SQL 迁移（0011 建表达库；0012 建 talk_turns；旧表保留）
tools/                      # 运维脚本（backup-db.sh 备份、export-chunks.mjs 导出语块）
deploy/                     # systemd 单元文件、nginx 的 Cloudflare 真实 IP 片段
seed/                       # 可选的词库快照
tmp/                        # 批量造卡脚本 batch-cards.ts 和它读的 CEFR 词表
```

## 搜索与列表性能

在仓库的 3,380 张种子词卡上，首页 20 张摘要的 JSON 为 2,629 字节，gzip 后为 1,406 字节。打开单张词卡时才请求图解与练习。

- **生成查重** 使用规范化的 `cards.word_key` 和迁移 0016 建立的索引。历史大小写变体保留原 ID，新写入按同一键查重。列表子串搜索仍需扫描候选行。
- **相关性排序** 按精确、前缀、子串和释义命中排序，同级再按使用次数、创建时间和 ID 降序，保证同一批生成的词卡也能稳定分页。
- **字段分流**：单个英文单词只搜词形、含中文只搜释义、多词短语两者都搜——彻底消除"输入完整单词被语义释义里的同字串误中"
- **TanStack Query `placeholderData`**：翻页/改搜索词时保留上一批并标记更新；更新期间禁用旧条目的打开与翻页，避免把上一页当成新结果
- **列表按页渲染**：词库与表达库每页 20 条，词卡条目使用 `React.memo`；回调随路由与阅读状态更新
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
#   ALLOWED_ORIGINS=https://你的正式域名（含非标准端口）

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

限流使用连接对端的 IP。只有对端列在 `TRUSTED_PROXY_IPS` 中时，应用才采用 nginx 写入的 `X-Real-IP` 和外部协议。systemd 单元已配置回环地址。Compose 部署请在 `.env` 填写容器实际看到的宿主机代理 IP，并设置完整的 `ALLOWED_ORIGINS`。

```nginx
proxy_set_header Host $http_host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-Proto $scheme;
```

如果站点在 Cloudflare 后面，`$remote_addr` 默认是 Cloudflare 节点的地址，所有访客会共用一个限流计数：有人猛刷登录接口，管理员自己也会被挡在登录之外。把 `deploy/nginx/wordloom-cloudflare-realip.conf` 放到 `/etc/nginx/snippets/` 并在 server 块里 `include`，nginx 会只对来自 Cloudflare 网段的连接采信 `CF-Connecting-IP`。Cloudflare 网段偶尔变动，对照 <https://www.cloudflare.com/ips/> 更新。

#### 深度分析任务

页面提交任务后按 ID 查询进度。同一卡片的并发请求共享任务，刷新页面后仍可查询。批量任务由服务器执行，进程重启会把被中断的任务标记为失败，可重新提交。已结束的任务保留 14 天。

#### 数据库备份

`tools/backup-db.sh` 用 `sqlite3 .backup` 创建一致性快照，检查数据库完整性和压缩包后才发布到 `backups/`。归档权限为 `600`，默认保留 14 天。

首次设置定时任务前先创建日志目录，否则 shell 在启动备份脚本之前就会因日志路径不存在而失败：

```bash
mkdir -p backups
```

```cron
17 4 * * * /path/to/wordloom/tools/backup-db.sh >> /path/to/wordloom/backups/backup.log 2>&1
```

`backups/` 与数据库在同一块盘上，只防误删和写坏，不防磁盘损坏；重要数据请再同步到机器之外。

服务启动和 `pnpm dev` 都会应用待执行迁移。升级前备份数据库，解压到另一文件并运行 `PRAGMA integrity_check`。0014 至 0016 会更新旧记录。需要恢复到升级前状态时，停服务后配套恢复旧构建和备份，并保留当前数据库及其 WAL 文件。

### Docker

```bash
cp .env.example .env
# 编辑 .env：
#   AUTH_TOKEN=你的登录密码
#   AUTH_SECRET=随机字符串（用于 cookie 签名）
#   ALLOWED_ORIGINS=https://你的正式域名（含非标准端口）
#   TRUSTED_PROXY_IPS=容器实际看到的宿主机代理地址

docker compose up -d --build
```

适合你明确想把运行时和宿主机隔离开时使用（CI 会用临时库验证镜像启动和登录）。根目录的 `nginx.conf` 是配合它的反代示例。注意 Docker 默认会把 SQLite 放进 named volume，不会直接使用仓库里的 `data/` 目录。

### 手动部署

```bash
pnpm build          # 构建前端 + 后端
pnpm db:migrate     # 运行数据库迁移
pnpm start          # 启动生产服务器（端口 3001）
```

## 开发检查

```bash
pnpm exec tsc -b --force   # 类型检查（根目录的 tsc --noEmit 不检查任何文件）
pnpm lint
pnpm test            # 使用内存 SQLite，不会碰 data/app.db
```

CI 在推送到 `main`、`refactor/v3.2` 以及 PR 更新时运行这些检查，另做生产构建、生产依赖审计，并用临时数据库验证容器启动和正式来源登录。

2026-11-27 修复复核覆盖 52 个文件、948 项测试。本轮 Chrome 验证了公开词卡在线与离线阅读、关闭或返回时保留表达草稿，以及一个标签页退出后另一个标签页立即离开私人页面。此前 1280px、390px、320px 下的布局与永久删除验收记录在界面文档中。[修复复核](docs/code-review-2026-11-27.md) · [界面验收](docs/refactor/07-ui-experience.md)

### 表达库的两份评测

对谈召回和练习判定的准确率需要人工标注样本。`tools/eval-expressions.ts` 使用应用配置的 Expressions 模型。召回走页面使用的流式回复和后续批注，两阶段共享 45 秒预算。判定直接运行练习使用的判分逻辑。

批量评测在数据库的**副本**上跑：每条对谈会保存聊天和使用记录，写进真库会影响学习统计。脚本拒绝在 `data/app.db` 上运行。副本含 API Key，评测集使用自己的句子，两样都放在仓库外面。

```bash
# 做副本。数据库是 WAL 模式，服务开着时不要直接拷 app.db：
# 用 sqlite3 做快照，或者先停服务，再把 app.db 连同还在的 app.db-wal、app.db-shm 一起拷走
mkdir -p ../eval
sqlite3 data/app.db ".backup ../eval/app.db"

# 在仓库根目录运行
DATABASE_URL=file:../eval/app.db npx tsx tools/eval-expressions.ts recall ../eval/recall.json
DATABASE_URL=file:../eval/app.db npx tsx tools/eval-expressions.ts judge ../eval/judge.json
```

```powershell
$env:DATABASE_URL = "file:../eval/app.db"
npx tsx tools/eval-expressions.ts recall ../eval/recall.json
npx tsx tools/eval-expressions.ts judge ../eval/judge.json
Remove-Item Env:DATABASE_URL   # 不清掉的话，这个终端里接着 pnpm dev 用的就是副本
```

**召回**（`recall`）回答「库里有的，问得出来吗」。评测集是一组你真实想说的话，每条写明库里应该回来哪几条：

```json
[
  { "need": "怎么说我突然意识到", "expect": ["dawned on"] },
  { "need": "一句库里没有对应说法的话", "expect": [] }
]
```

`expect` 可填条目 ID、焦点或原文片段，大小写不敏感。相同字面对应多个条目时，命中任一条即算。找不到预期条目会在调用模型前报错。每条样本仅发送 `need`。报告列出完整命中、部分命中、漏召回、无命中和多余命中，并单列回复与批注的成功率。全样本召回率以所有预期条目为分母，调用失败的样本也计入。无预期条目的样本单独计算误报率。

**判定**（`judge`）回答「它说我没用上，是真的没用上吗」。评测集是一组你已经知道对错的句子：

```json
[
  { "text": "It dawned on me that I was wrong.", "focus": "dawned on",
    "prompt": "你突然明白自己错了。", "answer": "It finally dawned on him.", "used": true }
]
```

`text` 和 `focus` 是那条表达（`focus` 可不写），`prompt` 是当时给的处境，`answer` 是写下的句子，`used` 是你自己的判断。要特意放几句「对，但写法不寻常」的。输出里最要紧的是 `uses the target, judged as not` 那一行：用上了却被判成没用上的比例。它高，「用出过」那个数就不可信，判定结果也就不该拿来记对错。

两份评测都报告耗时中位数与最大值。完成评测后，退出码 0 表示全部与标注一致，1 表示存在漏召回、多余命中或判定分歧，2 表示至少一次模型调用或批注失败。

## 环境变量

| 变量 | 说明 | 必填 |
|---|---|---|
| `AUTH_TOKEN` | 管理员登录密码（在 `/login` 输入） | 生产环境必填；本地要用表达库也要设，除非打开下面的本机试用开关 |
| `AUTH_SECRET` | Cookie 签名密钥（随机字符串） | 生产环境必填 |
| `EXPRESSIONS_OPEN_LOCALLY` | 设为 `1` 时，没设 `AUTH_TOKEN` 的非生产服务对本机发来的请求开放表达库，不用登录。只为在自己机器上试用 | 否（默认关） |
| `ALLOWED_ORIGINS` | 允许跨域访问 API 的前端 Origin（逗号分隔）。不设置时要求协议、主机、端口全部匹配 | 否（前后端同域时不需要） |
| `TRUSTED_PROXY_IPS` | 可代报客户端地址与外部协议的直接代理地址，逗号分隔 | 否（默认不信任代理） |
| `HOST` | 服务监听地址。Compose 容器显式设置为 `0.0.0.0`，宿主机仅发布回环端口 | 否（默认 `127.0.0.1`） |
| `DATABASE_URL` | SQLite 连接字符串 | 否（默认 `file:data/app.db`） |
| `PORT` | 服务端口 | 否（默认 3001） |

开发环境未设 `AUTH_TOKEN` 时，只有通过本机回环地址访问的本机请求能使用一般管理功能。远程请求仍可浏览公开词卡。

表达库默认还需要管理员口令。使用 `pnpm dev` 时，在启动服务的终端设置环境变量，再到 `/login` 登录。

```bash
AUTH_TOKEN=本地用的密码 pnpm dev            # bash
$env:AUTH_TOKEN = "本地用的密码"; pnpm dev   # PowerShell
```

只是在自己机器上试用、不想登录的话，可以改用本机试用的开关：

```bash
EXPRESSIONS_OPEN_LOCALLY=1 pnpm dev            # bash
$env:EXPRESSIONS_OPEN_LOCALLY = "1"; pnpm dev   # PowerShell
```

它只在三个条件同时成立时放行：没设 `AUTH_TOKEN`；不是生产模式（`NODE_ENV=production` 时无效，而生产模式没有 `AUTH_TOKEN` 根本不启动）；请求是这台机器自己发给自己的。最后一条看三样东西：连接来自本机；页面是用 `localhost`、`127.0.0.1` 或 `[::1]` 打开的（用局域网地址或机器名打开照旧是 503，这也挡住了把自己的域名改指到 127.0.0.1 的网页）；转发它的代理没有说它来自别的机器（`pnpm dev` 的开发代理会报来源地址，所以用 `vite --host` 把页面开给局域网时，别的设备仍然进不来）。设了 `AUTH_TOKEN` 它就不起作用，照常要登录。不要在前面有反向代理或隧道的服务上打开：一个不报来源地址、又把 `Host` 改写成本机的代理，在服务端看来和本机没有区别。放行的响应照样带 `no-store`，其余关于私人数据的规则不变。

权限模型：访客只能读词卡；`/api/*` 下其余的一切（生成、抽词、深度分析、删除、任务、设置、表达库）都需要管理员登录。公开白名单见 `src/server/middleware/guard.ts`。

## License

MIT

## 文档导航

当前功能和验收见 [界面与阅读体验](docs/refactor/07-ui-experience.md)，对谈协议见 [对谈页](docs/refactor/06-talk.md)，阶段记录见 [进度与偏差](docs/refactor/04-progress.md)。[重构交接](docs/refactor/README.md) 标明了历史方案、实施指南与当前实现的边界；旧规划不再作为从零开工的指令。
