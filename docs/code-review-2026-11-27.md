# WordLoom 代码与方案审查

## 修复复核

2026-11-27 在 `refactor/v3.2` 工作区完成 39 项发现对应的代码、迁移和配置修复，其中 9 项为 P1。下表的链接指向修复后的实现。后文保留初审时的现象、判断和行号。

| 初审编号 | 修复结果 |
|---|---|
| 01、11–13、28、29、33 | 生成结果按请求词逐项核对，卡片写入与任务终态一起提交。单卡深度分析共享任务，批次取消会停止自己创建的子任务。旧空壳可补做，任务历史只保留摘要，分页输入有上限。[卡片写入](../src/server/routes/cards.ts#L107) · [取消](../src/server/services/jobs.ts#L128) · [深度内容判定](../src/shared/card-deep.ts#L5) |
| 02–04、08、15、20、35 | 正式登录校验完整来源，真实 IP 只采信指定代理。设置按版本原子保存，更换服务来源需提供新密钥，设置异常日志去除绑定值。模型探测有请求上限，已保存配置的探测状态按版本恢复。[设置事务](../src/server/routes/settings.ts#L44) · [代理](../src/server/middleware/peer.ts#L7) · [探测状态](../src/client/components/settings/AIProvidersPage.tsx#L72) |
| 05、06、10、16、23、24、32、38 | 作答保留当时的练习焦点和激活时间，揭晓与翻案使用各自的发生时间。重复捕获和草稿保存校验数据库状态。单条详情按 ID 使用只读快照，四周统计保留当日记录，选区按原文位置区分。[读快照](../src/server/db/index.ts#L42) · [编辑基线](../src/server/routes/expressions.ts#L145) · [四周统计](../src/server/services/expressions-try.ts#L181) |
| 07、14、25、26、37 | 对谈的两种返回方式共用持久化路径，重发按消息 ID 去重，删除会话后迟到回复无法重建它。两种提供方都校验回复结束状态。候选按本轮文本筛选，评测走流式回复与批注，调用失败计入全样本分母。[候选筛选](../src/server/services/expressions-talk.ts#L97) · [保存](../src/server/services/expressions-talk.ts#L393) · [评测](../tools/eval-expressions.ts#L116) |
| 17–19、21、22、34、36 | 保存中输入的下一句得以保留，关闭和返回检查未保存草稿，删除末页记录会回到有效页码。退出跨标签清理私人页面。词卡列表只取摘要，已读详情可离线重开。损坏的 JSON 会报错，PWA 更新由用户主动触发。[草稿保护](../src/client/components/expressions/ExpressionDetail.tsx#L341) · [会话清理](../src/client/hooks/useAuth.ts#L26) · [列表字段](../src/server/routes/cards.ts#L391) · [离线缓存](../tools/pwa-cache.ts#L3) |
| 09、27、30、31、39 | 语块导出只写新文件，备份通过完整性与压缩检查后发布。宿主机 nginx 代理本机已发布端口，词卡提示遵循解释语言，交付分支纳入 CI 和容器登录冒烟。[导出](../tools/export-chunks.mjs#L75) · [备份](../tools/backup-db.sh#L28) · [nginx 示例](../deploy/nginx/wordloom.conf#L8) · [提示词](../src/server/services/ai-prompts.ts#L15) · [CI](../.github/workflows/ci.yml#L42) |

**本地验收。** Windows 上的 Node 22.23.5 和 26.13.0 均通过 TypeScript、ESLint、生产构建和全量 Vitest，共 52 个文件、948 项测试。Node 26 一次中间运行有一个测试子进程提前退出，默认并发复跑通过。npm 官方注册表的生产依赖审计返回零项已知通告。

**数据与恢复。** 在公开种子副本升级到 0016 后，3,380 张词卡、301 个语块、40 条表达、40 条相遇记录均保留，规范化词键缺失数与外键异常数均为零。首页 20 张词卡的 JSON 从 212,261 字节降到 2,629 字节，gzip 后从 83,301 降到 1,406 字节。语块导出成功。WSL 实跑备份及解压恢复，归档权限为 `600`，恢复后 `PRAGMA integrity_check` 返回 `ok`。所有数据库写入验证均在副本或临时库完成。

**并发与浏览器。** 在文件型 SQLite 上，两次同时捕获同一句分别返回 201、409，同时请求同卡深度分析复用一个任务，另一个连接持有写锁时仍能读取表达详情。生产构建接受配置的 HTTPS 来源登录，后续会话查询成功。Chrome 验证了公开词卡详情、在关闭和浏览器返回时取消丢弃草稿、双标签退出，以及停服后在独立离线标签页重开已读词卡。

**外部验收。** 初次本地复核通过了 Compose 配置校验，拉取 `node:22-slim` 时 Docker Hub 超时。分支推送后的 CI 独立构建容器并验证正式来源登录，结果按提交保留。真实模型的人工标注样本、线上 nginx 和 Cloudflare 验收按本轮范围跳过，模型召回率与判定准确率仍待实测。[分支 CI 记录](https://github.com/originem0/wordloom/actions/workflows/ci.yml?query=branch%3Arefactor%2Fv3.2)

## 初审基线

审查基线为 `refactor/v3.2` 的 `588465e31f32` 和 2026-11-27 北京时间 13:02:39 的工作区快照，含未提交的表达批注、词卡意象、生成提示词与 0013 迁移。

**初审时建议暂缓发布。** 当时有 9 项涉及数据完整性、隐私、凭证或正式部署，计入发布前处理项。

## 初审验证范围

在上述独立快照运行 TypeScript 工程检查、ESLint 和生产构建，全部通过。Vitest 共 52 个文件、925 项测试，全部通过。其中有一项去重测试在接口返回 500 时仍然通过，见第 28 项。发布种子的副本成功迁移到 0013。npm 官方注册表的生产依赖审计返回零项已知通告。

运行时验证使用一次性文件型 SQLite、仓库发布种子的副本、Chrome 和受控的模拟提供方。Chrome 检查了草稿丢失和末页删除。对谈删除、任务取消、学习统计、卡片覆盖和无效深度分析均检查了操作后的数据库状态。真实模型准确率、线上 nginx 与 Cloudflare 行为仍待验证。本机 Docker 守护进程未运行，容器部分依据配置文件审查。

## P1　发布前处理（9 项）

**01　生成新词能改掉已有词卡，还会漏报失败**

在临时库请求 aspen 和 elm，模拟模型只返回库里已有的 birch。接口答 200，成功列表只有 birch，失败列表为空，birch 原有释义也被替换。两套提供方都在 JSON 结构合法时直接放行，下游又按模型给出的词做覆盖写入。按本次待生成词的规范化集合对账，逐词识别漏项、额外项和重复项。插入冲突时读回已有卡，大小写去重规则也要落到数据库。 [openai-compat.ts L133](../src/server/services/openai-compat.ts#L133) · [gemini.ts L80](../src/server/services/gemini.ts#L80) · [cards.ts L137](../src/server/routes/cards.ts#L137) · [schema.ts L21](../src/server/db/schema.ts#L21)

**02　照 systemd 部署说明操作，正式域名无法登录**

部署步骤复制 .env.example，只提示替换两个认证值。示例却把允许来源固定为本机开发地址，systemd 会完整读取它。我用示例中的来源配置和正式站点形式的同源请求验证，正确口令收到 403。另一个独立风险是两个公开的示例口令都能通过生产启动的非空检查。生产模板应明确填写规范站点来源，部署冒烟测试应包含从该来源登录，启动时拒绝示例凭证。 [README.md L305](../README.md#L305) · [.env.example L2](../.env.example#L2) · [.env.example L6](../.env.example#L6) · [wordloom.service L11](../deploy/systemd/wordloom.service#L11) · [app.ts L88](../src/server/app.ts#L88) · [index.ts L4](../src/server/index.ts#L4)

**03　更换模型服务地址可以把旧密钥发给新主机**

模型检测允许单独修改地址。界面把草稿地址发到服务器，密钥输入留空时，服务端取出该提供方已经保存的密钥，随请求送往草稿地址。管理员正常切换中转商就会跨服务发送凭证。把密钥绑定到已确认的服务来源，跨来源测试要求输入属于新来源的密钥，并限制携带凭证的重定向。此项来自代码路径，验证使用的是模拟模型。 [AIProvidersPage.tsx L165](../src/client/components/settings/AIProvidersPage.tsx#L165) · [settingsTest.ts L402](../src/server/routes/settingsTest.ts#L402) · [settingsTest.ts L457](../src/server/routes/settingsTest.ts#L457) · [settingsTest.ts L500](../src/server/routes/settingsTest.ts#L500)

**04　保存 API 密钥失败时，完整密钥可能进入服务日志**

设置写入把 key 和 value 作为 SQL 绑定参数。当前 Drizzle 的查询异常会把这些参数拼进错误消息，应用只对表达路由脱敏，对设置路由直接记录整个异常。磁盘或数据库写入出错时，日志系统可能持有一份应用密钥。为凭证写入单独处理错误，只记录操作类别和底层错误码，并用虚构的标记值检查日志脱敏。 [settings.ts L53](../src/server/routes/settings.ts#L53) · [app.ts L180](../src/server/app.ts#L180) · [wordloom.service L20](../deploy/systemd/wordloom.service#L20)

**05　退出想用会把未达标的历史作答重新算成用出过**

我造了一条已收藏九天的表达。放进想用一小时后答对，按规则没有升档。只执行退回见过，统计立刻从 0 变成 1。退出会清掉 activeSince，回放旧作答时就丢了当时的 24 小时限制。应记录进入和退出的时点，按作答发生时的状态计算。旧数据缺失的状态要标出不确定性。 [expressions.ts L157](../src/server/routes/expressions.ts#L157) · [expressions-fold.ts L53](../src/server/services/expressions-fold.ts#L53) · [expressions-fold.ts L82](../src/server/services/expressions-fold.ts#L82) · [expressions-try.ts L156](../src/server/services/expressions-try.ts#L156)

**06　选了新练习焦点，仍用旧焦点的释义、题目和成绩**

同一句里把焦点从 set out 改成 turn back，接口返回了新焦点和旧释义，数据库保留了旧提示和旧题面，旧成绩也继续计入。当前 PATCH 只改 focus 和 norm。并且，改焦点前已发出的补注能在稍后写回。给练习目标加版本，把历史留在原目标下，清除或重新生成依赖焦点的字段，按版本接收迟到的模型结果。 [ExpressionDetail.tsx L194](../src/client/components/expressions/ExpressionDetail.tsx#L194) · [expressions.ts L144](../src/server/routes/expressions.ts#L144) · [expressions.ts L74](../src/server/routes/expressions.ts#L74) · [expressions-view.ts L48](../src/server/services/expressions-view.ts#L48)

**07　删除整场对话后，没有命中任何表达的私人发言仍然留着**

每轮对谈都把用户发言再次写进 encounters。零命中时也写原文，expression_id 留空。实测删除返回 204，对话表已清空，该发言仍有一份无关联的完整副本。表达库读取时又跳过这类行，用户从界面找不到它。需要统计活动日期时只留日期或计数，删除时清理无关联原文。与已收藏表达相连的学习记录应遵循界面说明的保留规则。 [expressions-talk.ts L298](../src/server/services/expressions-talk.ts#L298) · [expressions-talk.ts L314](../src/server/services/expressions-talk.ts#L314) · [expressions-talk.ts L455](../src/server/services/expressions-talk.ts#L455) · [expressions-view.ts L83](../src/server/services/expressions-view.ts#L83) · [TalkPage.tsx L209](../src/client/components/expressions/TalkPage.tsx#L209)

**08　部署默认监听范围与限流的信任假设冲突**

配置 AUTH_TOKEN 后，服务端省略监听地址。systemd 单元也没有指定回环地址，而限流直接采用请求头给出的客户端 IP。只要宿主机端口可直连，应用就失去了由 nginx 确认客户端地址的前提。开发端通过代理对局域网开放时，无口令的普通管理路由也缺少表达库守卫那层本机校验。给宿主机部署显式绑定回环地址，容器单独配置监听地址，只从受信代理采用转发身份。实际公网可达性取决于主机防火墙。 [index.ts L29](../src/server/index.ts#L29) · [rateLimit.ts L23](../src/server/middleware/rateLimit.ts#L23) · [auth.ts L29](../src/server/middleware/auth.ts#L29) · [guard.ts L68](../src/server/middleware/guard.ts#L68) · [wordloom.service L13](../deploy/systemd/wordloom.service#L13) · [vite.config.ts L56](../vite.config.ts#L56)

**09　语块导出工具可以覆盖源数据库**

在一次性 SQLite 文件上验证，输入与输出指向同一个文件时，工具以退出码 0 结束，原数据库已经变成 Markdown。已有的其他输出文件也会被静默替换。比对解析后的真实文件身份，拒绝原库作为输出，默认以独占方式新建输出文件。 [export-chunks.mjs L21](../tools/export-chunks.mjs#L21) · [写出文件 L100](../tools/export-chunks.mjs#L100)

## P2　功能、并发与方案缺陷（24 项）

**10　表达详情的只读请求占用写事务**

持有另一条正常 SQLite 写事务时，我通过真实 HTTP 读取同一个临时库，表达列表返回 200，详情返回 500。没有竞争的两次 HTTP 请求都返回 200。detailOf 使用 Drizzle 默认事务，这一版 libSQL 默认开启写事务。用真正的只读快照或一条查询读出详情，让写事务只覆盖需要原子提交的改动。 [expressions.ts L37](../src/server/routes/expressions.ts#L37) · [expressions.ts L128](../src/server/routes/expressions.ts#L128) · [index.ts L10](../src/server/db/index.ts#L10)

**11　任务显示已取消，模型继续运行，词卡照样入库**

让模拟模型在生成中途等待，取消任务，再让模型返回。任务最终仍是 cancelled，库里多出一张词卡。取消只改 jobs 行，前端连取消请求失败也显示已取消。服务端先查询状态再无条件更新，碰上完成写入还能改掉终态。把取消信号传给生成器，在落库事务里校验任务状态，客户端展示服务端返回的终态。 [jobs.ts L107](../src/server/services/jobs.ts#L107) · [jobs.ts L129](../src/server/services/jobs.ts#L129) · [jobs.ts L27](../src/server/routes/jobs.ts#L27) · [cards.ts L111](../src/server/routes/cards.ts#L111) · [tasks.ts L261](../src/client/store/tasks.ts#L261)

**12　空的深度分析会被永久当作成功**

让提供方返回空对象，第一次请求答 200，家族对比和边界测试都存为 []。再次点击产生零次模型调用，待补列表也为空。空数组序列化后是非空字符串，加上自动补出的 none 图式，前后端都判断为完成。定义最小可用内容，把没有有效输出记为可重试状态，同时兼容已经存成空壳的卡。 [validation.ts L140](../src/shared/validation.ts#L140) · [ai-normalize.ts L246](../src/server/services/ai-normalize.ts#L246) · [cards.ts L239](../src/server/routes/cards.ts#L239) · [cards.ts L378](../src/server/routes/cards.ts#L378) · [PrototypeWordCard.tsx L56](../src/client/components/cards/PrototypeWordCard.tsx#L56)

**13　补深度分析缺少同一卡片的并发去重，也超出反代等待窗口**

深度分析先查后调用模型，结果回来才保存。同时打开两页或在代理超时后重试，可以为同一卡付款两次，晚到的结果覆盖先到的。默认单次深度请求可等 120 秒，示例反代默认读超时为 60 秒。批量补全还由页面里的循环驱动，刷新会失去剩余进度。复用现有任务表，按卡 ID 只保留一个进行中的任务，用任务结果承接重连。 [cards.ts L233](../src/server/routes/cards.ts#L233) · [cards.ts L267](../src/server/routes/cards.ts#L267) · [CardCollection.tsx L109](../src/client/components/cards/CardCollection.tsx#L109) · [README.md L336](../README.md#L336)

**14　普通 JSON 对谈能让刚删除的会话重新出现，重发也会重复记账**

实测先让续聊等待模型，再删除整场对话。删除答 204，迟到的 JSON 续聊仍答 201，并用旧会话 ID 插入了一轮。流式保存已有存在性检查，普通路径只在模型调用之前检查。请求也没有客户端消息 ID，丢失最终响应后重发会生成另一轮。统一两条保存路径，在事务内确认会话存在，以稳定的消息 ID 去重。新会话应由数据库分配标识，毫秒时间戳可能碰撞。 [expressions-talk.ts L191](../src/server/services/expressions-talk.ts#L191) · [expressions-talk.ts L297](../src/server/services/expressions-talk.ts#L297) · [expressions-talk.ts L321](../src/server/services/expressions-talk.ts#L321) · [expressions-talk.ts L335](../src/server/services/expressions-talk.ts#L335) · [validation.ts L76](../src/shared/validation.ts#L76)

**15　模型配置的一次保存被拆成二十多次独立写入**

页面顺序写回多个路由和提供方字段，包括没有编辑过的字段。每次写后还会使设置查询失效。中途失败会留下一套半新半旧的配置，旧标签页也能覆盖后来修改的模型或地址。运行时还分开读取密钥和地址。一次提交变更字段，在一个数据库事务中校验和保存，以同一快照读取一组服务凭证。 [AIProvidersPage.tsx L262](../src/client/components/settings/AIProvidersPage.tsx#L262) · [AIProvidersPage.tsx L281](../src/client/components/settings/AIProvidersPage.tsx#L281) · [useSettings.ts L24](../src/client/hooks/useSettings.ts#L24) · [settings.ts L53](../src/server/routes/settings.ts#L53) · [openai-compat.ts L33](../src/server/services/openai-compat.ts#L33)

**16　普通表达编辑和重复确认缺少一致的并发保护**

捕获的查重发生在插入事务之前，而 norm 为允许另存而刻意不设唯一约束。普通编辑同样先读状态、校验提示，再另开事务落库。多个编辑者或标签页可能依据同一份旧状态作决定。前端还把初始化过的表单与最新查询结果比较，未经编辑的旧值也可能被当成变更写回。把条件检查移入写事务，普通编辑携带版本或原值，复用片段批注已有的冲突处理方式。 [expressions.ts L106](../src/server/routes/expressions.ts#L106) · [expressions.ts L137](../src/server/routes/expressions.ts#L137) · [expressions.ts L164](../src/server/routes/expressions.ts#L164) · [expressions.ts L198](../src/server/routes/expressions.ts#L198) · [ExpressionDetail.tsx L146](../src/client/components/expressions/ExpressionDetail.tsx#L146)

**17　保存第一句期间写下的第二句会被清空**

Chrome 中延迟第一条保存响应，在输入框继续写第二句，第一条成功后输入框变空。输入框只在帮我挑时只读，保存回调却无条件清空当下的内容。成功时只清掉与本次提交相同的草稿版本，保留提交后输入的新内容。 [CaptureBox.tsx L60](../src/client/components/expressions/CaptureBox.tsx#L60) · [CaptureBox.tsx L77](../src/client/components/expressions/CaptureBox.tsx#L77) · [CaptureBox.tsx L120](../src/client/components/expressions/CaptureBox.tsx#L120)

**18　关闭详情会无提示丢掉普通笔记、焦点和提示句草稿**

在 Chrome 改写普通笔记后点关闭，确认框出现零次，重新打开只剩旧笔记。现有 unsavedRef 只拦截点击弹窗外部，关闭按钮和 Esc 使用的回调只检查片段批注。浏览器返回也可能直接卸载弹窗。让所有退出入口共享脏状态判断，给正常笔记和片段批注同样的保护。 [ExpressionDetail.tsx L152](../src/client/components/expressions/ExpressionDetail.tsx#L152) · [ExpressionDetail.tsx L321](../src/client/components/expressions/ExpressionDetail.tsx#L321) · [ExpressionsPage.tsx L101](../src/client/components/expressions/ExpressionsPage.tsx#L101)

**19　删掉第二页唯一一张词卡，会失去返回第一页的分页按钮**

Chrome 中用 21 张卡复现。删除后还有 20 张，页面显示第 2 / 1 页，上一页按钮数量为零。词卡只在筛选条件变化时重置页码，分页组件遇到总页数为一就隐藏导航。列表数量变化时也要收敛到有效页，并重新请求那一页。表达列表已经有这一处理。 [CardCollection.tsx L55](../src/client/components/cards/CardCollection.tsx#L55) · [pagination-controls.tsx L17](../src/client/components/ui/pagination-controls.tsx#L17) · [ExpressionsPage.tsx L75](../src/client/components/expressions/ExpressionsPage.tsx#L75)

**20　默认的同源检查只比较主机名，忽略协议和端口**

空白名单是文档支持的部署方式。这时服务端按 hostname 批准写请求，相同主机名下的其他端口被视为同一个来源。不同应用共享主机名时，这个信任范围大于浏览器的同源边界。配置公开站点的完整 origin，并比较规范化后的协议、主机和端口。代理应传递或配置外部端口。 [app.ts L58](../src/server/app.ts#L58) · [app.ts L88](../src/server/app.ts#L88) · [nginx.conf L35](https://github.com/originem0/wordloom/blob/588465e31f321224bc1e3fe9e0bdf8bd00c7a5ba/nginx.conf#L35)

**21　退出登录只清当前标签页，其他已打开的私人页面会继续展示旧内容**

退出清理当前内存中的 QueryClient。对谈还把完整消息保存在组件状态里。其他标签页没有退出通知，重新获得焦点时默认也不重查，通常的 401 只被包装成错误。共享设备交接时，旧页面可继续显示私人原文。广播退出事件，集中处理会话失效，卸载私人页面并清理其状态。服务器的权限校验与这部分屏幕残留是两条独立路径。 [useAuth.ts L55](../src/client/hooks/useAuth.ts#L55) · [query-client.ts L8](../src/client/lib/query-client.ts#L8) · [api.ts L33](../src/client/lib/api.ts#L33) · [TalkPage.tsx L50](../src/client/components/expressions/TalkPage.tsx#L50)

**22　词卡列表为 20 行摘要传输了 212,261 字节**

用仓库发布的 3,380 张种子卡实测首页。原 JSON 为 212,261 字节，gzip 后 83,301 字节。保留同一页的 ID、词、级别、释义和分页信息只需 2,629 字节，gzip 后 1,406 字节。每次搜索、翻页都会解析未打开卡片的图解和练习。增加列表投影，打开卡片时使用已有详情接口，分别缓存摘要和详情。 [cards.ts L354](../src/server/routes/cards.ts#L354) · [cards.ts L364](../src/server/routes/cards.ts#L364) · [CardCollection.tsx L265](../src/client/components/cards/CardCollection.tsx#L265) · [useCards.ts L32](../src/client/hooks/useCards.ts#L32)

**23　取一条表达、一次作答或一个朗读文本，都会读取整个库的学习历史**

loadEntry 调用 loadLibrary 后才 find，读一次作答也遍历整库。长对话先把整场记录取回再截取模型需要的窗口，回看时又逐轮扫描学习历史和重建匹配器。首页统计还会对首四周的写入反复回放历史。表达数量只有几百也挡不住学习记录按天增长。单条读走 ID 和关联索引，排队只取必要字段，历史窗口在 SQL 中截取。优先测详情和统计的查询行数。 [expressions-view.ts L78](../src/server/services/expressions-view.ts#L78) · [expressions-view.ts L97](../src/server/services/expressions-view.ts#L97) · [expressions-try.ts L51](../src/server/services/expressions-try.ts#L51) · [expressions-try.ts L174](../src/server/services/expressions-try.ts#L174) · [expressions-talk.ts L140](../src/server/services/expressions-talk.ts#L140) · [expressions-talk.ts L191](../src/server/services/expressions-talk.ts#L191)

**24　四周评估的起点会随种子和删除操作移动**

统计把当前最早表达的创建时间当上线时间，随后只数 28 天。实际种子的最早记录是 2026-11-25，在 12 月 23 日之后首次导入的用户，个人评估窗口已经结束。删除最早表达又会移动整扇窗口。过去哪些天可测还依赖条目的当前分层。应保存独立的评估开始时间，并按当时发生的状态变化计算历史指标。 [expressions-try.ts L158](../src/server/services/expressions-try.ts#L158) · [expressions-view.ts L109](../src/server/services/expressions-view.ts#L109) · [05-p2-decisions.md L128](../docs/refactor/05-p2-decisions.md#L128) · [README.md L5](../seed/README.md#L5)

**25　召回评测没有测用户实际使用的对谈流程**

页面先流式回复，再由第二次模型调用给出命中。评测脚本走普通 JSON 对谈，用另一个提示一次生成回复和命中。失败样本还会跳过召回率的分母。只要有一次调用得到结果，即使所有判定都错，脚本也会以 0 退出。原方案把约 20 句人工标注设为判定可以记账的前提，交接文档仍把它和 30 条召回样本列为待办。用页面的执行路径评测，分别报告请求成功率、全样本召回率和误判率，再用约定的阈值决定是否采信学习指标。 [eval-expressions.ts L106](../tools/eval-expressions.ts#L106) · [分母 L118](../tools/eval-expressions.ts#L118) · [退出状态 L172](../tools/eval-expressions.ts#L172) · [TalkPage.tsx L57](../src/client/components/expressions/TalkPage.tsx#L57) · [expressions-talk.ts L204](../src/server/services/expressions-talk.ts#L204) · [expressions-ai.ts L170](../src/server/services/expressions-ai.ts#L170) · [01-plan-v3.2.md L194](../docs/refactor/01-plan-v3.2.md#L194) · [交接清单 L43](../docs/refactor/README.md#L43)

**26　对谈每轮都发送大段表达索引，排在预算外的旧表达始终没有召回机会**

候选按状态和新旧依次加入，达到 60,000 字符就停止。某些旧条目即使与本轮最相关，也进不了模型的候选集。流式回复和批注还分别发送索引。先测命中率随库大小和条目年龄的变化，再试用已有字段做相关性预筛。这个阶段用 SQLite 就能验证改进幅度。 [expressions-talk.ts L70](../src/server/services/expressions-talk.ts#L70) · [expressions-talk.ts L85](../src/server/services/expressions-talk.ts#L85) · [expressions-ai.ts L166](../src/server/services/expressions-ai.ts#L166) · [expressions-ai.ts L170](../src/server/services/expressions-ai.ts#L170)

**27　备份会把凭证和私人数据以宿主机默认权限写出，压缩失败还会留下正式文件名**

数据库包含模型密钥、表达和对话。脚本没有收紧 umask，常见的 022 会让新建的 gzip 文件对其他本机用户可读。压缩也直接写最终路径，磁盘写满时残包仍符合备份命名规则。先创建仅服务账号可读的临时文件，压缩后校验并原子改名，用一次实际恢复确认备份可用。 [backup-db.sh L19](../tools/backup-db.sh#L19) · [backup-db.sh L24](../tools/backup-db.sh#L24) · [backup-db.sh L34](../tools/backup-db.sh#L34) · [settings.ts L53](../src/server/routes/settings.ts#L53)

**28　去重回归测试在接口返回 500 时仍然通过**

本轮测试输出报告 db.transaction is not a function。该用例的数据库替身没有 transaction，断言也只检查发给模型的词，没有检查响应或保存结果。保留模型替身，使用已有的临时 SQLite，断言 HTTP 状态、成功与失败集合和最终行值。 [cards.dedup.test.ts L25](../src/server/routes/__tests__/cards.dedup.test.ts#L25) · [cards.dedup.test.ts L88](../src/server/routes/__tests__/cards.dedup.test.ts#L88) · [cards.ts L203](../src/server/routes/cards.ts#L203)

**29　公共列表的入参不能保证分页上限和搜索语义**

page 和 limit 直接经 Number、Math.min 和 Math.max 计算。非有限值和小数缺少边界校验，部分输入会使查询出错或使当前 Drizzle 省略 LIMIT。搜索中的 SQL 通配符也会改变字面匹配含义。先校验有限正整数和搜索长度，并为字面搜索转义通配符。按创建时间排序时补上 ID，否则同毫秒生成的一批卡没有明确的分页次序。 [cards.ts L293](../src/server/routes/cards.ts#L293) · [cards.ts L298](../src/server/routes/cards.ts#L298) · [cards.ts L349](../src/server/routes/cards.ts#L349) · [jobs.ts L37](../src/server/routes/jobs.ts#L37)

**30　仓库给 Docker 的 nginx 示例无法直接用于说明中的宿主机拓扑**

Compose 只有 app 服务，把端口发布在宿主机回环地址上。nginx 示例却把上游写成 Docker 服务名，并在 nginx 自己的文件系统中读取 /app/dist/client。照抄到宿主机时，上游名称和静态目录都没有由 Compose 提供。给宿主机示例指向已发布端口，并把静态请求一并交给现有应用，或交付完整的容器网络与静态文件挂载。 [docker-compose.yml L2](../docker-compose.yml#L2) · [nginx.conf L20](https://github.com/originem0/wordloom/blob/588465e31f321224bc1e3fe9e0bdf8bd00c7a5ba/nginx.conf#L20) · [nginx.conf L34](https://github.com/originem0/wordloom/blob/588465e31f321224bc1e3fe9e0bdf8bd00c7a5ba/nginx.conf#L34) · [README.md L367](../README.md#L367)

**31　设置英语解释后，生成指令仍要求核心释义和词源使用中文**

设置页承诺这个选项控制新词卡的词义、词源和深度分析。两种提供方拼接进去的基础提示却明确要求核心释义、词源和近义词辨析用中文，英文偏好又要求服从字段里的中文要求。模型逐条遵循指令，也会给选择英语的人生成中文解释。把字段的语言要求统一从偏好生成，保留固定使用英语的例句。按三种设置检查最终发给提供方的完整提示。 [SettingsPage.tsx L195](../src/client/components/settings/SettingsPage.tsx#L195) · [ai-prompts.ts L15](../src/server/services/ai-prompts.ts#L15) · [词源 L18](../src/server/services/ai-prompts.ts#L18) · [辨析 L47](../src/server/services/ai-prompts.ts#L47) · [英文偏好 L103](../src/server/services/ai-prompts.ts#L103) · [openai-compat.ts L114](../src/server/services/openai-compat.ts#L114) · [gemini.ts L62](../src/server/services/gemini.ts#L62)

**32　迟到的判分会取消用户在此之前已经挣到的升档**

直接用生产折叠函数回放两次作答。第 2 天那次待判，第 6 天答对，升档次数为 1。把第一条补记为第 9 天判错，次数降为 0。同一条若在第 2 天及时判错，第 6 天的升档就保留。代码按作答时间排序，却把未来的判分时间立刻当成已经看过答案。方案已记载这个边界，翻案时还会覆盖首次判分时间。分别记录作答、揭晓和翻案的发生时刻，按每次作答前实际发生的事件判定资格。 [expressions-fold.ts L60](../src/server/services/expressions-fold.ts#L60) · [升档 L82](../src/server/services/expressions-fold.ts#L82) · [揭晓时间 L99](../src/server/services/expressions-fold.ts#L99) · [expressions-try.ts L124](../src/server/services/expressions-try.ts#L124) · [05-p2-decisions.md L89](../docs/refactor/05-p2-decisions.md#L89)

**33　任务表不断保留整张词卡，同一张已有卡还会存两份**

在发布种子副本里提交 10 张已有卡，新增词卡为 0，单条任务结果却占 214,386 字节。两个数组各存 10 张完全相同的卡。接着删除其中一张，任务详情仍能读出它的完整内容。清理已完成任务只改变浏览器状态，服务端任务列表会读回整批结果。任务历史存卡片 ID、计数和必要错误即可，给已结束任务设置保留期限。 [cards.ts L105](../src/server/routes/cards.ts#L105) · [jobs.ts L86](../src/server/services/jobs.ts#L86) · [任务列表 L38](../src/server/routes/jobs.ts#L38) · [tasks.ts L283](../src/client/store/tasks.ts#L283)

## P3　维护与交付改进（6 项）

**34　成功状态下的损坏 JSON 会变成一个假成功对象**

apiFetch 在 2xx 响应无法解析时返回强制断言为任意类型的空对象。代理误送 HTML、响应截断等情况会进入成功回调，故障转移到更远的 UI 或缓存。只对预期无内容的响应返回空值，其他 JSON 解析错误在请求边界显式失败。 [api.ts L49](../src/client/lib/api.ts#L49) · [useExpressions.ts L56](../src/client/hooks/useExpressions.ts#L56)

**35　模型探测的绿灯可以属于旧配置，批量探测也缺少总预算**

健康结果只按路由名缓存，更换提供方、地址或模型后仍能沿用上一套配置的成功结果。检测时又会为上游列出的每个候选发一次模型请求，并发上限为每批五个，缺少整批截止时间。按有效配置标记探测结果，配置一变就置为待测，只验证实际选择的候选或限制每批数量。 [AIProvidersPage.tsx L226](../src/client/components/settings/AIProvidersPage.tsx#L226) · [AIProvidersPage.tsx L529](../src/client/components/settings/AIProvidersPage.tsx#L529) · [settingsTest.ts L175](../src/server/routes/settingsTest.ts#L175) · [settingsTest.ts L234](../src/server/routes/settingsTest.ts#L234)

**36　PWA 更新会打断编辑，懒加载异常还会反复刷新**

取得新 Service Worker 控制权就刷新整个页面。任何懒加载异常也都会刷新，持续失败时没有单次重试记录。另一个清缓存按钮会清掉整个源的 sessionStorage 和 Cache Storage，影响同源其他应用。编辑期间延迟更新，失败时保留可恢复的错误页，并按 WordLoom 的存储前缀清理。 [main.tsx L7](../src/client/main.tsx#L7) · [App.tsx L17](../src/client/App.tsx#L17) · [SettingsPage.tsx L102](../src/client/components/settings/SettingsPage.tsx#L102)

**37　两套上游适配器对完整回复的判断不一致**

OpenAI 的 SSE 分支要求看到结束信号。Gemini 分支只排除已知的异常结束原因，迭代器正常结束且积累过文字就接受。兼容网关退回普通 JSON 时也只检查文本。上游把半截回复当作正常 EOF 或返回长度截断的普通 JSON 时，后续会把半句当成完整对话保存。按各上游协议校验完成原因，为缺失结束标记和截断信号增加回归。 [gemini.ts L261](../src/server/services/gemini.ts#L261) · [openai-compat.ts L341](../src/server/services/openai-compat.ts#L341) · [openai-compat.ts L365](../src/server/services/openai-compat.ts#L365) · [expressions-talk.ts L398](../src/server/services/expressions-talk.ts#L398)

**38　逐字保存和练习焦点在 UI 与数据模型中各有一套含义**

普通粘贴和选区在提交前都会 trim，首尾空格、换行会消失。片段批注保存了精确偏移，选择练习焦点却退回文本去重，同一句中两处相同短语会变成一个选项。用规范化副本做查重，原文保存用户选取的字符。需要区分出现位置时让焦点引用已有片段坐标。 [shared.ts L51](../src/client/components/expressions/shared.ts#L51) · [ExpressionDetail.tsx L113](../src/client/components/expressions/ExpressionDetail.tsx#L113) · [schema.ts L179](../src/server/db/schema.ts#L179) · [README.md L47](../README.md#L47)

**39　当前交付分支的直接推送不会触发仓库 CI**

交接约定向 refactor/v3.2 推送，工作流只响应 main 的 push 和 PR 事件。直接交付到该分支就跳过了类型检查、测试、构建与依赖审计。CI 使用 Node 22，Docker 两阶段均使用 Node 20，也没有运行容器启动或正式来源登录的检查。把实际交付分支纳入现有工作流，增加临时数据库和生产配置的启动冒烟。 [ci.yml L4](../.github/workflows/ci.yml#L4) · [ci.yml L26](../.github/workflows/ci.yml#L26) · [Dockerfile L17](../Dockerfile#L17) · [README.md L35](../docs/refactor/README.md#L35)

## 初审建议的修复顺序

第一批先为卡片写入、学习状态转移、对话删除和凭证处理补上能检查最终状态的回归，再改实现。第二批统一普通与流式对谈的保存逻辑，把取消、重试和配置保存落实到数据库事务。第三批用公开种子衡量列表体积，用标注样本衡量召回与判定。下一轮功能扩展应以这两组实测结果为依据。
