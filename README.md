# WordLoom

AI 驱动的英语学习工具。上传图片生成英语故事，点击生词生成词汇卡片——阅读、听力、词汇在一个闭环里完成。

## 功能

**Story Studio** — 图片 → 英语故事 → 语音朗读

- 上传图片，AI 生成 100-180 词的紧凑散文风格短文（tight prose, every sentence earns its place）
- 故事文本可交互：双击单词生成词汇卡片；已有卡片自动跳转，不重复生成
- 故事文本框支持一键复制
- 自定义指令折叠面板：支持多行输入，默认收起不占空间
- TTS：浏览器离线朗读 / Edge TTS（免费）/ Gemini TTS（AI 语音）
- 一键翻译为中文
- Google Search Grounding 自动补充真实信息
- 生成任务走异步 Job 队列（`jobId` + 轮询），避免"前端先失败、后端晚成功"的错觉

**Word Forge** — 词汇激活卡片生成器

- **查/造合一**：一个统一搜索框驱动整个模块——输入即过滤已有卡片；当输入的单词在词库中不存在时，自动出现"生成词卡"CTA，回车即可生成
- **三种生成入口**：直接输入单词（支持逗号/空格分隔最多 10 个词）、粘贴文本 AI 抽取生词、从故事中双击点选
- **智能搜索路由**：自动识别输入语种
  - 中文 → 匹配释义（coreMeaning）
  - 英文 → 匹配单词（word）
  - 混合/多词短语 → 同时匹配单词和释义
- **相关性排序**：搜索结果按 `精确匹配 > 前缀匹配 > 子串匹配 > 仅释义命中` 排序，再叠加 usageCount 和 createdAt——输入 `set` 时 `setup` 排前面，`asset/closet` 排后面，永远找得到精确那张
- **重复检测**：已有单词不再调用 AI 重新生成，直接返回已有卡片
- **卡片生成走异步 Job 队列**，状态由服务端权威返回（queued/running/done/failed/cancelled）
- 分层卡片结构：
  - **Surface** — 音标、词性、CEFR 等级、语义核心、WAD/WAP 指标
  - **Middle** — 搭配骨架、语境阶梯（3 级例句）、词源（中文解释）、近反义词、常用短语
  - **Deep**（按需生成，Solarized 沉浸式极简 UI）— 包含 **5 大深度认知模块**，均为可折叠面板：
    - **核心意象 (Core Image)**：AI 为每个单词定制生成专属 SVG 动画（如 engage → 齿轮咬合，diverge → 路径分叉），附中文画面描述。无法生成时 fallback 到 5 种认知图式模板（blockage / container / path / link / balance）。
    - **词根词源 (Etymology)**：中文溯源，展示语义演化链条（Evolution Chain）。
    - **场景激活 (Scene Activation)**：可折叠。基于单词在特定领域下的典型框架提供沉浸式情景描述与关联词群。
    - **家族对比 (Family Comparison)**：可折叠。横向对比表格显示同源/易混淆词汇的核心区别、情感语域和典型场景，并生成总结式辨析笔记。
    - **边界测试 (Boundary Tests)**：可折叠。带遮挡的交互式填空测验，多词语备选及详尽的正误原因辨析。
- 卡片集合：CEFR 筛选、使用追踪、Deep 层批量重试
- 深层内容懒加载并缓存，不重复调用 AI

**Chunk Forge** — 多词预制组块（Prefabricated Patterns）

词卡处理单个词；Chunk Forge 处理**多词组块**——句子骨架（"with a growing sense of X"）、动词搭配（"attach importance to"）、介词直觉（"for all their X"）、名介结构、话语标记。这些在传统词典里是"句法+词汇"的混合体，AI 给出统一结构化分析。

- **AI 判定三态**：`chunk`（典型组块）/ `borderline`（边界）/ `not_chunk`（自由组合，不入库）
- **结构化卡片**：
  - **Form** — 带 slot 占位符的标准形式（如 `with a (growing) sense of X`），slot 填充器示例
  - **Core meaning + 中文释义 (coreMeaningZh) + 机制描述 (coreMechanic)** — 它"在做什么"的三层表达
  - **Register / Frequency** — 语域（neutral/formal/spoken/academic/literary）+ 频率（high/mid/low）
  - **Examples** — 按 register 标注的真实例句（2-3 条）
  - **Pitfall** — 一句话点明 L1 干扰陷阱
  - **Contrast** — 最多 3 个易混淆同类 chunk 的精细辨析
  - **Theoretical anchors** — 理论锚点（idiom principle / formulaic sequence / lexical priming 等）
- **去重 upsert**：以 `(form, category)` 为唯一键，相同组块重新分析会更新而非新增
- **空库引导**：库里 0 条时显示 5 个示例 chip（每类一个），点击即填入输入框
- **同套搜索/排序逻辑**：英文搜 form、中文搜 coreMeaning + coreMeaningZh，相关性排序一致

**移动端适配**

- 卡片详情页使用原生全屏 overlay（非 Dialog），滚动流畅无截断
- 紧凑排版：缩小标题/字号/间距，核心意象描述降为辅助色
- 关闭按钮 sticky 跟随滚动

**主题**

- 亮色：默认 shadcn/ui
- 暗色：Solarized Dark 配色方案（base03 背景 #002b36，cyan accent #2aa198，blue primary #268bd2）

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 19, Vite, Tailwind CSS v4, shadcn/ui, TanStack Query |
| 后端 | Hono (TypeScript), Node.js |
| 数据库 | SQLite (Drizzle ORM + libSQL) |
| AI | 双 Provider：Gemini API + OpenAI-compatible（DeepSeek / GLM / Grok / Kimi 等中转站） |
| TTS | Edge TTS (免费) / Gemini TTS / 浏览器 SpeechSynthesis |
| 部署 | Docker + nginx |
| PWA | vite-plugin-pwa, autoUpdate + controllerchange 自动刷新 |

## 快速开始

```bash
# 安装依赖
pnpm install

# 启动开发服务器（前后端同时启动）
pnpm dev
```

浏览器访问 `http://localhost:5173`，进入 AI Providers 页面配置连接和模型。

## AI 服务配置

应用内分为两个配置页面：

### AI Providers（`/providers`）— 需要登录

管理 AI 连接、模型探测和路由分配。此页面需要管理员登录才能访问。

- **双 Provider 支持**：Gemini（官方或中转站）+ OpenAI-compatible（DeepSeek / GLM / Grok / Kimi 等），各自独立的 API Key 和 Base URL
- **Detect & Verify**：探测中转站实际可用模型，逐个 ping 验证可用性（并发 5，自动过滤不可用模型）
- **Model Routing**：Story / Cards / Deep / Chunks / Utility 五条路由，每条可独立选择 provider + primary model + fallback model
- **Test Routes**：每条路由可单独 ⚡ 测试，也可 Test All Routes；测试使用与实际任务相同强度的 prompt（Story 发真实图片、Cards/Deep 验证 JSON schema、Utility 测翻译）
- **测试结果持久化**：绿点/红点 + 失败原因保留在 sessionStorage，刷新不丢失
- **Gemini TTS**：TTS 模型和 voice 配置
- **Usage Limits**：配置未登录用户每日生成限额（Story / Cards / Deep 独立配置）

### Settings（`/settings`）— 公开

管理 TTS、语言、外观等偏好。任何人可访问。

- **TTS Provider**：browser / edge / gemini，primary + fallback；仅显示所选 provider 的配置（voice 等）
- **Language**：解释性文本语言偏好（简体中文 / English / Bilingual）
- **Appearance**：亮色 / 暗色 / 跟随系统
- **Network Tolerance**：可调 `api_timeout_ms`（默认 60s，deep 路由自动 ×2）和 `api_max_retries`
- **App Refresh & Cache**：强制刷新 PWA、清理本地缓存

### 容错机制

- **Per-route timeout 倍率**：Story ×1.5、Deep ×2，适配复杂请求
- **智能重试**：仅重试暂态错误（502/503/timeout/rate limit），配额超限（RPD/TPD/quota）和认证错误立即失败
- **Model fallback**：primary 失败后自动尝试 fallback model
- **日志可追溯**：retry 和 fallback 切换均打印具体错误原因

### 权限与安全

- **公开页面**：Story Studio、Word Forge、Settings — 任何人无需登录即可使用
- **管理页面**：AI Providers (`/providers`) — 需要管理员登录（保护 API key 和模型配置）
- **每日生成限额**：未登录用户按 IP 限制每天 AI 调用次数（Story / Cards / Deep 独立计数），已登录管理员不受限制
- **敏感字段隐藏**：GET /api/settings 对未登录用户隐藏 base URL 等敏感信息
- **CSRF 防护**：POST/PUT 请求强制检查 Origin header

### 生成任务机制（Async Jobs）

- `POST /api/stories/generate?async=1` / `POST /api/cards/generate?async=1` 会立即返回 `202 + jobId`
- 前端任务队列轮询 `GET /api/jobs/:id` 获取权威状态（queued/running/done/failed/cancelled）
- 可通过 `POST /api/jobs/:id/cancel` 发起取消（best effort）
- 兼容旧客户端：不带 `async=1` 仍可走同步返回

### 配置参考

| 配置项 | 说明 | 默认值 |
|---|---|---|
| Gemini API Key | Gemini API 密钥或中转站密钥 | 按需填写 |
| Gemini Base URL | 留空用 Google 官方 API；填中转站地址走代理 | Google 官方 |
| OpenAI API Key | OpenAI-compatible 提供商的 API 密钥 | 按需填写 |
| OpenAI Base URL | 如 `https://api.deepseek.com` | 必填（使用 OpenAI provider 时） |
| `{route}_provider` | 每条路由的 AI 提供商 | `gemini` |
| Story Model / Fallback | 图片生成故事用的主/备模型 | `gemini-2.5-pro` / 空 |
| Cards Model / Fallback | 卡片生成（短 JSON）主/备模型 | 继承通用模型 / 空 |
| Deep Model / Fallback | 深度分析（长 JSON）主/备模型 | 继承通用模型 / 空 |
| Chunks Model / Fallback | 组块判定 + 结构化分析主/备模型 | 继承通用模型 / 空 |
| Utility Model / Fallback | 轻量任务（抽词/翻译）主/备模型 | 继承通用模型 / 空 |
| TTS Provider (Primary / Fallback) | 朗读方式 | `browser` / 空 |
| Gemini TTS Model / Fallback | Gemini 语音朗读模型 | `gemini-2.5-flash-preview-tts` / 空 |
| API Timeout | 单次 AI 请求超时（deep 自动 ×2） | `60000` ms |
| Max Retries | AI 请求重试次数 | `3` |
| Daily Story Limit | 未登录用户每天 Story 生成数 | `20` |
| Daily Cards Limit | 未登录用户每天 Cards 生成词数 | `50` |
| Daily Deep Limit | 未登录用户每天 Deep 分析数 | `100` |

**使用中转站示例**：如果你的中转站是 `https://x666.me`，在 AI Providers 中：
- API Key → 中转站给的 key
- API Base URL → `https://x666.me`
- 先点 **Detect & Verify** 探测并验证可用模型
- 在 Story / Cards / Deep / Utility 路由里从检测结果中选主模型和 fallback
- 点 **Test All Routes** 或每条路由的 ⚡ 验证实际可用性

## 项目结构

```
src/
├── client/                 # React SPA
│   ├── components/
│   │   ├── story/          # Story Studio（图片上传、交互式故事、TTS）
│   │   ├── cards/          # Word Forge（统一查/造输入、激活卡片、集合视图）
│   │   ├── chunks/         # Chunk Forge（多词组块判定与卡片）
│   │   ├── settings/       # SettingsPage + AIProvidersPage + SettingWidgets
│   │   ├── layout/         # 导航壳（5 tab: Story/Cards/Chunks/AI/Settings）、错误边界
│   │   ├── auth/           # 登录页
│   │   └── ui/             # shadcn/ui 组件
│   ├── hooks/              # TanStack Query hooks（useCards / useChunks / ...）
│   ├── lib/                # API 客户端、工具函数
│   └── store/              # Zustand（任务队列、主题）
├── server/                 # Hono 后端
│   ├── routes/             # API 路由（auth, stories, cards, chunks, settings, jobs）
│   ├── services/
│   │   ├── ai-router.ts    # Provider 分发（读 {route}_provider 设置，含 chunks 路由）
│   │   ├── ai-shared.ts    # Retry/timeout/settings/semaphore/fallback
│   │   ├── ai-prompts.ts   # Prompt 常量 + 语言指令（cards / deep / chunk）
│   │   ├── ai-normalize.ts # JSON 解析 + schema drift 容错（cards + chunks）
│   │   ├── gemini.ts       # Gemini SDK 调用
│   │   ├── openai-compat.ts # OpenAI-compatible raw fetch 调用
│   │   ├── edge-tts.ts     # Edge TTS
│   │   └── image.ts        # 图片压缩
│   ├── middleware/         # 认证（httpOnly cookie + HMAC session）+ rateLimit/dailyLimit
│   └── db/                 # Drizzle schema + 连接（含 chunks 表）
└── shared/                 # 前后端共享类型和校验（types.ts, validation.ts）

drizzle/                    # SQL 迁移（0006 含 lower(word)/lower(form) 表达式索引）
tools/                      # 离线脚本（如 import-chunks.py）
deploy/systemd/             # systemd 单元文件
```

## 搜索与列表性能

针对词库 6000+ 条规模做了一组优化，6000 行下双击单词查重 < 5ms，搜索 < 30ms：

- **表达式索引**：`drizzle/0006_word_form_lower_indexes.sql` 给 `cards.word` 和 `chunks.form` 建 `lower(...)` 表达式索引，所有大小写不敏感等值/前缀查询走索引
- **相关性排序**：`ORDER BY CASE WHEN exact / prefix / substr / meaning-only END, usageCount DESC, createdAt DESC` 让精确匹配置顶
- **字段分流**：英文输入只搜词形、中文只搜释义、混合短语两者都搜——彻底消除"输入完整单词被语义释义里的同字串误中"
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

### Docker

```bash
cp .env.example .env
# 编辑 .env：
#   AUTH_TOKEN=你的登录密码
#   AUTH_SECRET=随机字符串（用于 cookie 签名）

docker compose up -d --build
```

适合你明确想把运行时和宿主机隔离开时使用。注意 Docker 默认会把 SQLite 放进 named volume，不会直接使用仓库里的 `data/` 目录。

### 手动部署

```bash
pnpm build          # 构建前端 + 后端
pnpm db:migrate     # 运行数据库迁移
pnpm start          # 启动生产服务器（端口 3001）
```

## 环境变量

| 变量 | 说明 | 必填 |
|---|---|---|
| `AUTH_TOKEN` | 登录密码（打开网页时输入） | 生产环境必填 |
| `AUTH_SECRET` | Cookie 签名密钥（随机字符串） | 生产环境必填 |
| `ALLOWED_ORIGINS` | 允许的前端域名（逗号分隔） | 生产环境建议设置 |
| `DATABASE_URL` | SQLite 连接字符串 | 否（默认 `file:data/app.db`） |
| `PORT` | 服务端口 | 否（默认 3001） |

开发环境不设置 `AUTH_TOKEN` 则跳过认证。

## License

MIT
