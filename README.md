# WordLoom

AI 驱动的英语学习工具。上传图片生成英语故事，点击生词生成词汇卡片——阅读、听力、词汇在一个闭环里完成。

## 功能

**Story Studio** — 图片 → 英语故事 → 语音朗读

- 上传图片，AI 生成 100-180 词的紧凑散文风格短文（tight prose, every sentence earns its place）
- 故事文本可交互：双击单词生成词汇卡片；已有卡片自动跳转，不重复生成
- 故事文本框支持一键复制
- 自定义指令折叠面板：支持多行输入，默认收起不占空间
- 双模式 TTS：浏览器离线朗读 / Edge TTS（免费）/ AI 语音
- 一键翻译为中文
- Google Search Grounding 自动补充真实信息

**Word Forge** — 词汇激活卡片生成器

- 三种输入：手动输入单词、粘贴文本 AI 提取生词、从故事中双击点选
- 重复检测：已有单词不再调用 AI 重新生成，直接返回已有卡片
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
| AI | Gemini API（服务端代理，支持中转站，密钥不暴露） |
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

浏览器访问 `http://localhost:5173`，进入 Settings 页面配置 API。

## AI 服务配置

在应用内 **Settings** 页面配置，所有配置存储在服务端数据库中：

| 配置项 | 说明 | 默认值 |
|---|---|---|
| API Key | Gemini API 密钥（[申请](https://aistudio.google.com/apikey)）或中转站密钥 | 必填 |
| API Base URL | 留空用 Google 官方 API；填入中转站地址则走代理 | Google 官方 |
| Story Model | 图片生成故事用的模型 | `gemini-2.5-pro` |
| General Model | 卡片生成、翻译、词汇提取用的模型 | `gemini-2.5-flash` |
| TTS Model | AI 语音朗读用的模型 | `gemini-2.5-flash-preview-tts` |
| TTS Preference | TTS 默认方式 | `browser` / `edge` / `gemini` |

**使用中转站示例**：如果你的中转站是 `https://x666.me`，在 Settings 中：
- API Key → 中转站给的 key
- API Base URL → `https://x666.me`
- 模型名 → 按中转站支持的模型填写（如 `gpt-5.2`）

## 项目结构

```
src/
├── client/                 # React SPA
│   ├── components/
│   │   ├── story/          # Story Studio（图片上传、交互式故事、TTS）
│   │   ├── cards/          # Word Forge（词汇输入、激活卡片、集合视图）
│   │   ├── settings/       # 设置页
│   │   ├── layout/         # 导航壳、错误边界
│   │   ├── auth/           # 登录页
│   │   └── ui/             # shadcn/ui 组件
│   ├── hooks/              # TanStack Query hooks
│   ├── lib/                # API 客户端、工具函数
│   └── store/              # Zustand（任务队列、主题）
├── server/                 # Hono 后端
│   ├── routes/             # API 路由（auth, stories, cards, settings）
│   ├── services/           # AI 服务（gemini.ts）、Edge TTS、图片压缩
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
