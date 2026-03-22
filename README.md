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

- 三种输入：手动输入单词、粘贴文本 AI 提取生词、从故事中双击点选
- 重复检测：已有单词不再调用 AI 重新生成，直接返回已有卡片
- 卡片生成同样走异步 Job 队列，状态由服务端权威返回（queued/running/done/failed/cancelled）
- 分层卡片结构：
  - **Surface** — 音标、词性、CEFR 等级、语义核心、WAD/WAP 指标
  - **Middle** — 搭配骨架、语境阶梯（3 级例句）、词源（中文解释）、近反义词、常用短语
  - **Deep**（按需生成，Solarized 沉浸式极简 UI）— 包含 **5 大深度认知模块**，均为可折叠面板：
    - **核心意象 (Core Image)**：AI 为每个单词定制生成专属 SVG 动画（如 engage → 齿轮咬合，diverge → 路径分叉），附中文画面描述。无法生成时 fallback 到 5 种认知图式模板（blockage / container / path / link / balance）。
    - **词根词源 (Etymology)**：中文溯源，展示语义演化链条（Evolution Chain）。
    - **场景激活 (Scene Activation)**：可折叠。基于单词在特定领域下的典型框架提供沉浸式情景描述与关联词群。
    - **家族对比 (Family Comparison)**：可折叠。横向对比表格显示同源/易混淆词汇的核心区别、情感语域和典型场景，并生成总结式辨析笔记。
    - **边界测试 (Boundary Tests)**：可折叠。带遮挡的交互式填空测验，多词语备选及详尽的正误原因辨析。
- 卡片集合：搜索、CEFR 筛选、使用追踪
- 深层内容懒加载并缓存，不重复调用 AI

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

### AI Providers（`/providers`）

管理 AI 连接、模型探测和路由分配。

- **双 Provider 支持**：Gemini（官方或中转站）+ OpenAI-compatible（DeepSeek / GLM / Grok / Kimi 等），各自独立的 API Key 和 Base URL
- **Detect & Verify**：探测中转站实际可用模型，逐个 ping 验证可用性（并发 5，自动过滤不可用模型）
- **Model Routing**：Story / Cards / Deep / Utility 四条路由，每条可独立选择 provider + primary model + fallback model
- **Test Routes**：每条路由可单独 ⚡ 测试，也可 Test All Routes；测试使用与实际任务相同强度的 prompt（Story 发真实图片、Cards/Deep 验证 JSON schema、Utility 测翻译）
- **测试结果持久化**：绿点/红点 + 失败原因保留在 sessionStorage，刷新不丢失
- **Gemini TTS**：TTS 模型和 voice 配置

### Settings（`/settings`）

管理 TTS、语言、外观等偏好。

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
| Utility Model / Fallback | 轻量任务（抽词/翻译）主/备模型 | 继承通用模型 / 空 |
| TTS Provider (Primary / Fallback) | 朗读方式 | `browser` / 空 |
| Gemini TTS Model / Fallback | Gemini 语音朗读模型 | `gemini-2.5-flash-preview-tts` / 空 |
| API Timeout | 单次 AI 请求超时（deep 自动 ×2） | `60000` ms |
| Max Retries | AI 请求重试次数 | `3` |

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
│   │   ├── cards/          # Word Forge（词汇输入、激活卡片、集合视图）
│   │   ├── settings/       # SettingsPage + AIProvidersPage + SettingWidgets
│   │   ├── layout/         # 导航壳（4 tab: Story/Cards/AI/Settings）、错误边界
│   │   ├── auth/           # 登录页
│   │   └── ui/             # shadcn/ui 组件
│   ├── hooks/              # TanStack Query hooks
│   ├── lib/                # API 客户端、工具函数
│   └── store/              # Zustand（任务队列、主题）
├── server/                 # Hono 后端
│   ├── routes/             # API 路由（auth, stories, cards, settings, jobs）
│   ├── services/
│   │   ├── ai-router.ts    # Provider 分发（读 {route}_provider 设置）
│   │   ├── ai-shared.ts    # Retry/timeout/settings/semaphore/fallback
│   │   ├── ai-prompts.ts   # Prompt 常量 + 语言指令
│   │   ├── ai-normalize.ts # JSON 解析 + schema drift 容错
│   │   ├── gemini.ts       # Gemini SDK 调用
│   │   ├── openai-compat.ts # OpenAI-compatible raw fetch 调用
│   │   ├── edge-tts.ts     # Edge TTS
│   │   └── image.ts        # 图片压缩
│   ├── middleware/         # 认证（httpOnly cookie + HMAC session）
│   └── db/                 # Drizzle schema + 连接
└── shared/                 # 前后端共享类型和校验（types.ts, validation.ts）
```

## 部署

### Docker（推荐）

```bash
cp .env.example .env
# 编辑 .env：
#   AUTH_TOKEN=你的登录密码
#   AUTH_SECRET=随机字符串（用于 cookie 签名）

docker compose up -d --build
```

nginx 自动处理反向代理和静态资源缓存。HTTPS 通过 certbot 配置。

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
