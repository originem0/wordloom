# WordLoom

AI 驱动的英语学习工具。上传图片生成英语故事，点击生词生成词汇卡片——阅读、听力、词汇在一个闭环里完成。

## 功能

**Story Studio** — 图片 → 英语故事 → 语音朗读

- 上传图片，Gemini 生成 150-250 词的看图说话范文
- 故事文本可交互：点击任意单词即刻生成词汇卡片
- 双模式 TTS：浏览器离线朗读 / Gemini AI 语音
- 一键翻译为中文
- Google Search Grounding 自动补充真实信息

**Word Forge** — 词汇激活卡片生成器

- 三种输入：手动输入单词、粘贴文本 AI 提取生词、从故事中点选
- 分层卡片结构：
  - **Surface** — 音标、词性、CEFR 等级、语义核心、WAD/WAP 指标
  - **Middle** — 搭配骨架、语境阶梯（3 级例句）、词源、近反义词、常用短语
  - **Deep**（按需展开）— 家族对比表、认知图式分析、边界测试
- 卡片集合：搜索、CEFR 筛选、使用追踪
- 深层内容懒加载并缓存，不重复调用 AI

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 19, Vite, Tailwind CSS v4, shadcn/ui, TanStack Query |
| 后端 | Hono (TypeScript), Node.js |
| 数据库 | SQLite (Drizzle ORM + libSQL) |
| AI | Google Gemini API（服务端代理，密钥不暴露） |
| 部署 | Docker + nginx |

## 快速开始

```bash
# 安装依赖
pnpm install

# 启动开发服务器（前后端同时启动）
pnpm dev
```

浏览器访问 `http://localhost:5173`，在 Settings 中填入 [Gemini API Key](https://aistudio.google.com/apikey)。

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
│   └── store/              # Zustand（仅主题等客户端状态）
├── server/                 # Hono 后端
│   ├── routes/             # API 路由（auth, stories, cards, settings）
│   ├── services/           # Gemini AI、图片压缩、TTS 音频处理
│   ├── middleware/         # 认证（httpOnly cookie）
│   └── db/                 # Drizzle schema + 连接
└── shared/                 # 前后端共享类型和校验
```

## 部署

### Docker（推荐）

```bash
cp .env.example .env
# 编辑 .env，设置 AUTH_TOKEN 和 AUTH_SECRET

docker compose up -d
```

nginx 自动处理 HTTPS（通过 certbot）和静态资源缓存。

### 手动部署

```bash
pnpm build          # 构建前端 + 后端
pnpm db:migrate     # 运行数据库迁移
pnpm start          # 启动生产服务器（端口 3001）
```

## 环境变量

| 变量 | 说明 | 必填 |
|---|---|---|
| `AUTH_TOKEN` | 访问令牌（登录时输入） | 生产环境必填 |
| `AUTH_SECRET` | Cookie 签名密钥 | 生产环境必填 |
| `PORT` | 服务端口（默认 3001） | 否 |

Gemini API Key 在应用内 Settings 页面配置，存储在服务端数据库中。

## License

MIT
