# 技术架构完善方向

分析日期：2026-05-25。  
目标：把当前演示型 MVP 演进为可部署、可扩展、可审计、可接入真实数据的地灾监测平台。本文侧重技术架构，不重复业务缺陷描述。

## 当前架构判断

当前系统是三段式架构：

- 前端：Vue 3 + Vite + Element Plus + Pinia + ECharts + Leaflet。
- 后端：Fastify + TypeScript + better-sqlite3，路由内直接写 SQL。
- 模型服务：FastAPI + PyTorch；本地演示可启用启发式 fallback，生产默认关闭。

这个架构适合 MVP 演示，优点是简单、启动快、联调成本低。主要短板是：领域边界薄、数据模型偏静态、权限和审计不足、没有任务队列、没有 schema migration、没有稳定的接口契约和测试体系。

## 本轮已落地的架构加固

本轮先完成第一阶段中的“低风险底座加固”，没有改动数据库结构和业务主流程：

- 新增运行模式：`APP_MODE=demo|production`。生产模式会拒绝默认、过短和模板占位 JWT 密钥，避免演示密钥被误用于正式部署。
- 登录提供方接口按运行模式返回演示账号：demo 模式保留，production 模式不再暴露默认账号密码。
- 生产模式不再初始化演示账号；空用户库必须通过 `INITIAL_ADMIN_USERNAME`、`INITIAL_ADMIN_PASSWORD` 创建首个管理员。
- 生产启动会检测已有数据库中的默认演示凭据，发现 `admin/admin123`、`operator/operator123`、`expert/expert123` 仍可用时拒绝启动。
- `APP_MODE` 显式校验为 `demo|production`，避免拼错后静默退回 demo 模式。
- 生产模式必须配置 `AI_INFERENCE_BASE_URL`，禁止分析接口静默写入 mock AI 结果。
- 新增 `DATABASE_PATH` 可选覆盖，便于回归测试使用隔离数据库；未配置时仍使用默认 `backend/data/geoprophet.db`。
- 新增统一错误类型和全局错误映射：参数错误返回 400，文件过大返回 413，上游模型失败返回 502，模型超时返回 504。
- 上传链路增加白名单和文件头校验：群众上报图片限制为 jpg/jpeg/png/webp；分析影像支持 jpg/jpeg/png/webp/tif/tiff；伪造 MIME 或扩展名但内容不匹配会被拒绝。
- 外部模型服务调用增加后端超时控制：通过 `AI_INFERENCE_TIMEOUT_MS` 配置，默认 30 秒。
- 前端分析请求使用独立 axios 实例，timeout 调整为 45 秒，避免模型任务被普通接口 8 秒超时误杀。
- `/api/health` 增加运行模式返回，便于部署检查。

第二批继续补齐权限和审计底座：

- 新增 RBAC 守卫：`requireRoles(...)` 可和 `authenticate` 组合使用，写操作已有后端权限检查落点。
- 新增审计日志表 `audit_logs`，记录操作者、角色、动作、实体、摘要、元数据、IP、User-Agent 和时间。
- 新增审计写入工具 `writeAuditLog(...)`，避免各业务路由手写 SQL。
- 关键动作已接入审计：登录成功/失败、预警新增、预警确认、群众上报提交、群众图片上传、AI 识别完成。
- 新增管理员审计查询接口：`GET /api/system/audit-logs?limit=50`。
- 初始化 SQL 和运行期 schema 都包含 `audit_logs`，新库和旧库启动时都能补齐审计表。

第三批补齐可观测性和运行健康：

- API 入口支持透传/生成 `x-request-id`，并在响应头返回同一个追踪 ID。
- 所有错误响应都会带 `requestId`，便于前端、日志和审计记录对齐排查。
- 审计日志新增 `request_id` 字段，关键业务动作能关联到请求链路。
- `/api/health` 升级为依赖健康快照，检查数据库和可选模型服务，并返回 `ok/degraded/skipped` 状态。
- 后端健康检查会解析模型服务 `/health` 响应体；模型服务返回 `status=degraded` 时 API 健康也降级。
- 模型服务自身在缺权重等 degraded 状态下返回 HTTP 503，便于 Docker healthcheck 正确阻断后续服务启动。
- 新增 `HEALTH_CHECK_TIMEOUT_MS`，避免健康检查被模型服务拖住。
- 初始化 SQL 和运行期 schema 增加常用索引：预警状态/时间、群众上报状态/时间、观测传感器/时间、识别任务时间、审计时间、审计实体。
- 运行期 schema 会为旧库补 `audit_logs.request_id` 字段。

第四批补齐入口安全和流量保护：

- 生产模式必须配置 `CORS_ORIGINS` 白名单；demo 模式仍默认允许全部来源，便于本地联调。
- 新增 `TRUST_PROXY` 配置；生产经 Caddy/Nginx 反代时开启，审计 IP 和限流 key 才会使用真实客户端 IP。
- API 统一返回基础安全响应头：`x-content-type-options`、`x-frame-options`、`referrer-policy`、`permissions-policy`。
- 新增轻量 IP 固定窗口限流工具 `createRateLimiter(...)`，无需额外依赖。
- 登录接口接入独立限流，默认 5 分钟 20 次。
- 公众上报和图片上传接入公众入口限流，默认 5 分钟 60 次。
- AI 识别提交接入分析任务限流，默认 5 分钟 20 次。
- 新增限流响应头：`x-ratelimit-limit`、`x-ratelimit-remaining`、`x-ratelimit-reset`、`retry-after`。
- 新增配置项：`RATE_LIMIT_WINDOW_MS`、`AUTH_RATE_LIMIT_MAX`、`PUBLIC_RATE_LIMIT_MAX`、`ANALYSIS_RATE_LIMIT_MAX`。

第五批补齐数据库迁移治理：

- 新增轻量 runtime migration ledger：`schema_migrations`，记录迁移 ID、名称和应用时间。
- 新增迁移工具模块 `applyRuntimeMigrations(...)` 和 `listRuntimeMigrations(...)`。
- 当前运行期补丁已纳入第一条迁移：`20260525_001_analysis_audit_indexes`。
- 额外增加启动期 schema invariant 补齐逻辑；即使旧库已经记录迁移 ID，也会补齐关键表、列和索引。
- 新库会通过 `init.sql` 创建 `schema_migrations`，旧库会在启动时自动补表并记录已应用迁移。
- 新增管理员接口：`GET /api/system/migrations`，用于查看已应用的运行期迁移。
- 这仍是轻量方案，后续迁移到 PostgreSQL/PostGIS 时可替换为正式 migration runner，但当前已经具备“版本可见、补丁有序、启动幂等”的基础。

第六批补齐领域事件 / Outbox 基础：

- 新增 `domain_events` 表，记录事件类型、聚合类型、聚合 ID、payload、状态、重试次数、requestId、创建时间和发布时间。
- 新增事件工具模块 `emitDomainEvent(...)` 和 `listDomainEvents(...)`。
- 新增运行期迁移：`20260525_002_domain_events_outbox`。
- 关键业务动作同步写领域事件：`alert.created`、`alert.acknowledged`、`report.submitted`、`analysis.completed`。
- 新增管理员接口：`GET /api/system/domain-events?limit=50`，用于查看事件 outbox。
- 当前只完成 outbox 落库，不直接投递短信、WebSocket、大屏或第三方系统；下一步可增加 worker 扫描 pending 事件并发布。

## 回归测试修复记录

本轮针对架构加固后的高风险路径做了真实 HTTP 回归，发现并修复十七处问题：

- 上传校验只检查 MIME 和扩展名，伪造 `image/png` 的文本内容仍可能被保存。已补 jpg/png/webp/tiff 文件头 magic number 校验。
- 群众上报不传 `siteId` 时，SQLite 命名参数缺失导致 500。已将可选 `siteId`、`imageUrl` 入库前规范化为 `null`。
- 生产模式只隐藏演示账号列表，但旧 demo 数据库仍可用 `admin/admin123` 登录。已改为生产模式拒绝默认演示凭据，且全新生产库只能通过环境变量创建初始管理员。
- 前端登录页仍预填 `admin/admin123` 并固定显示默认账号文案。已改为空表单，只有 demo 模式接口返回账号时才展示演示账号区。
- 文件头校验引入兼容性问题：合法 PNG/WebP/TIFF 如果文件名没有扩展名，会被 fallback 为 `.jpg` 后误拒。已改为先识别真实文件头，再在扩展名缺失时推断安全后缀。
- 部分手动错误响应绕过全局异常处理，响应体没有 `requestId`。已补齐未登录、登录失败、参数不完整、资源不存在等手动错误响应的 `requestId`。
- 生产反代部署下未开启 `trustProxy`，审计 IP 和限流 key 可能都是 Nginx/Caddy 容器 IP，导致多用户共享限流桶。已新增 `TRUST_PROXY` 配置，并在生产模板中开启。
- `/api/health` 返回体已标记 `degraded`，但 HTTP 状态仍是 200，Docker healthcheck 会误判依赖异常为健康。已改为 degraded 返回 503。
- 外部模型服务返回 200 但响应体不是 JSON 或不是对象时，后端会落成 500。已改为统一返回 502，并保留 requestId。
- 前端 TIFF 预览判断只看文件扩展名；无扩展名但 MIME 为 `image/tiff` 的文件会被当普通图片预览。已改为同时检查文件名和 MIME。
- 半升级旧库若已记录 `20260525_001`，但 `audit_logs` 表缺少后来补的 `request_id` 列，登录审计会 500。已新增启动期 schema invariant，迁移账本跳过时仍补齐关键列。
- `APP_MODE=prod` 等拼写错误会静默进入 demo 模式并暴露演示账号。已改为非法值直接拒绝启动。
- production 未配置 `AI_INFERENCE_BASE_URL` 时，分析接口会走 mock 推理并写入正式识别记录。已改为生产启动强制要求模型服务地址。
- 生产模板和模型服务镜像默认允许启发式 fallback，缺权重时仍可能返回演示推理。已将生产模板、HTTPS 模板、模型服务默认值改为 `ALLOW_HEURISTIC_FALLBACK=false`，本地 compose 保持显式 demo fallback。
- API 健康检查只看模型服务 HTTP 200，忽略响应体 `status=degraded`。已改为解析模型健康 JSON，并把 degraded 透传为 API 503。
- 模型服务 `/health` 返回体 degraded 但 HTTP 状态仍是 200，Docker 会把缺权重服务标为 healthy。已改为模型服务 degraded 时返回 HTTP 503。
- 地灾图层接口在 `GEOHAZARDS_DATA_DIR` 未挂载或缺文件时直接 500。已改为返回 404 和 requestId，overview 仍可降级为空数据。

已复测通过的路径：

- `/api/health` 依赖健康和 requestId。
- demo 登录、生产模式密钥校验、生产模式隐藏演示账号。
- 生产模式会拦截已有默认演示账号的旧库。
- 全新生产库只允许配置的初始管理员登录，`admin/admin123` 被拒绝。
- 上传伪造图片拒绝、合法 PNG 文件头接受。
- 无扩展名但 MIME/内容合法的 PNG 上传会被保存为 `.png`。
- 群众上报图片仍拒绝 TIFF，AI 分析入口允许无扩展名 TIFF 并保存为 `.tif`。
- 手动 400/401/403/404 错误响应体会保留请求 `requestId`。
- operator 访问管理员系统接口会返回 403。
- `TRUST_PROXY=true` 时审计日志记录真实 `X-Forwarded-For` 客户端 IP。
- 公众上报限流达到阈值后返回 429 和 `retry-after`。
- 模型服务降级时 `/api/health` 返回 HTTP 503。
- 模型服务健康但推理响应为坏 JSON 时，分析接口返回 502。
- 生产 CORS 白名单允许配置的 Origin，非白名单 Origin 不返回 `Access-Control-Allow-Origin`。
- 半升级旧库缺少 `audit_logs.request_id` 时，启动会自动补列，登录审计不再 500。
- 非法 `APP_MODE` 会拒绝启动。
- production 缺少 `AI_INFERENCE_BASE_URL` 会拒绝启动。
- 模型服务返回 HTTP 200 但健康体为 `degraded` 时，API `/api/health` 返回 503 并透传 warning。
- 模型服务缺权重时 `/health` 返回 HTTP 503。
- `GEOHAZARDS_DATA_DIR` 为空时，图层详情返回 404 而不是 500。
- 不带 `siteId` 的公众上报。
- 预警新增和确认。
- mock 滑坡识别。
- 审计日志 requestId。
- 迁移 ledger 查询。
- domain events 查询和关键事件落库。

涉及文件：

- `backend/db/init.sql`
- `backend/src/audit.ts`
- `backend/src/config.ts`
- `backend/src/db.ts`
- `backend/src/errors.ts`
- `backend/src/events.ts`
- `backend/src/guards.ts`
- `backend/src/health.ts`
- `backend/src/migrations.ts`
- `backend/src/rate-limit.ts`
- `backend/src/uploads.ts`
- `backend/src/server.ts`
- `backend/src/routes/analysis.ts`
- `backend/src/routes/auth.ts`
- `backend/src/routes/alerts.ts`
- `backend/src/routes/reports.ts`
- `backend/src/routes/system.ts`
- `backend/src/services/hazard-analysis.ts`
- `frontend/src/lib/api.ts`
- `frontend/src/views/AnalysisView.vue`
- `frontend/src/views/LoginView.vue`
- `model-service/app/config.py`
- `model-service/Dockerfile`
- `docker-compose.prod.yml`
- `docker-compose.https.yml`
- `.env.production.example`

验证结果：

- `npm run build` 已通过，包含后端 `tsc`、前端 `vue-tsc --noEmit` 和 Vite 构建。

## 架构演进原则

1. 先稳住接口和数据，再扩展功能。
2. 后端以领域模块组织，不让路由直接承载全部业务规则。
3. 所有关键业务动作要有状态机、审计日志和幂等设计。
4. AI 推理是异步业务能力，不应长期作为同步 HTTP 附属工具。
5. 演示模式和生产模式要隔离，不能让 mock/fallback 混入正式数据。

## 第一阶段：MVP 加固

建议周期：1-2 周。目标是不大改结构，但先把上线风险降下来。

### 1. 配置与安全加固

现状证据：

- demo 模式仍保留默认账号，便于本地演示。
- production 模式已经拦截默认/占位 JWT、强制 CORS 白名单、禁止默认演示凭据。
- production 空库通过 `INITIAL_ADMIN_USERNAME`、`INITIAL_ADMIN_PASSWORD` 创建首个管理员。

改造方向：

- 补账号管理页面：修改密码、重置密码、禁用账号、角色调整。
- 补密码策略：复杂度、过期时间、失败锁定、历史密码复用限制。
- 如果接入 OIDC，应将本地账号降级为 break-glass 管理入口，并独立审计。

### 2. 统一错误处理和参数校验

现状证据：

- 多个路由使用 `zod.parse`，错误会落入全局 500。
- `backend/src/server.ts:48-51` 统一把所有异常返回 500。

改造方向：

- 增加错误分类：`ValidationError -> 400`、`Unauthorized -> 401`、`Forbidden -> 403`、`NotFound -> 404`、`Conflict -> 409`。
- Zod schema 统一放到模块级文件，并复用到 OpenAPI。
- 外键失败、唯一约束失败转换为业务错误。

### 3. 上传链路治理

现状证据：

- `backend/src/routes/reports.ts:72-84` 直接保存上传。
- `backend/src/services/hazard-analysis.ts:94-107` 直接保存分析文件。

改造方向：

- 增加 MIME、扩展名、文件头 magic number 校验。
- 上传文件生成 hash，避免重复存储。
- 图片处理和病毒扫描可异步化。
- 私有文件和公开图片分目录，敏感附件用鉴权访问。

### 4. AI 推理请求治理

现状证据：

- `backend/src/services/hazard-analysis.ts:127-130` 直接 `fetch` 外部模型服务。
- `frontend/src/lib/api.ts:6-9` axios 全局 8 秒超时。

改造方向：

- 后端对模型服务调用使用 `AbortController` 设置独立超时。
- 前端分析接口使用单独 axios 实例或请求级 timeout。
- 记录模型服务响应时间、错误码、fallback 状态。
- 外部模型不可用时返回可解释错误，不静默当作普通失败。

### 5. 最小测试体系

现状：

- 当前没有自动化测试。

改造方向：

- 后端增加接口测试：登录、权限、点位查询、预警状态、上报、上传、分析。
- 模型服务增加 schema 和 fallback 推理测试。
- 前端增加关键页面 smoke test。
- CI 中固定执行 `npm run build`、`python -m compileall` 和测试。

## 第二阶段：后端领域架构重构

建议周期：3-6 周。目标是让业务规则从路由里沉淀出来。

### 1. 按领域拆分模块

建议模块：

- `auth`：登录、用户、角色、权限、OIDC。
- `monitoring`：点位、传感器、观测值、接入批次、质控。
- `alerts`：预警状态机、预警事件、发布记录。
- `reports`：群众上报、附件、审核、转预警。
- `analysis`：模型任务、识别结果、专家复核。
- `assessment`：影响评估任务、版本、发布。
- `audit`：审计日志和安全日志。

推荐结构：

```text
backend/src/modules/
  alerts/
    alerts.routes.ts
    alerts.service.ts
    alerts.repository.ts
    alerts.schema.ts
    alerts.workflow.ts
  reports/
  analysis/
  monitoring/
```

### 2. 路由、服务、仓储分层

当前问题：

- 路由中直接写 SQL，业务规则、数据访问和 HTTP 处理混在一起。

改造方向：

- `routes` 只处理 HTTP 入参/出参。
- `service` 处理业务规则和状态流转。
- `repository` 处理 SQL 和事务。
- 跨模块操作必须从 service 调用，不直接跨表散写。

收益：

- 后续加入 PostgreSQL、队列、权限、审计时，不需要重写所有路由。
- 业务规则可以独立测试。

### 3. 数据库迁移体系

当前问题：

- `backend/db/init.sql` 同时承担建表和演示数据初始化。
- 运行期只用 `CREATE TABLE IF NOT EXISTS` 兜底。

改造方向：

- 引入迁移工具，例如 `drizzle-kit`、`knex migrations` 或轻量自研 migration runner。
- 拆分 `schema migrations`、`seed demo data`、`test fixtures`。
- 每次 schema 变更都有版本号和回滚策略。

目标：

```text
backend/db/migrations/
  0001_initial_schema.sql
  0002_alert_workflow.sql
  0003_report_review.sql
backend/db/seeds/
  demo.sql
```

## 第三阶段：数据与任务架构升级

建议周期：6-10 周。目标是支撑真实接入和异步 AI。

### 1. 从 SQLite 演进到 PostgreSQL/PostGIS

原因：

- 地灾业务天然依赖空间查询、行政区边界、风险区 polygon、缓冲区分析。
- SQLite 适合本地演示，不适合多用户并发、复杂空间分析和生产运维。

改造方向：

- PostgreSQL 管理业务数据。
- PostGIS 管理点位、上报坐标、风险区、道路、居民点等空间数据。
- SQLite 可保留为单机 demo 模式。

### 2. 引入任务队列

适用场景：

- AI 图片识别。
- 批量观测值质控。
- 遥感成果处理。
- 预警趋势计算。
- 通知发布和处置任务派发。

建议方向：

- Node 后端使用 BullMQ + Redis，或独立 worker 服务。
- API 只创建任务并返回 task id。
- 前端轮询或使用 WebSocket/SSE 获取任务状态。

状态模型：

```text
queued -> running -> succeeded
                 -> failed
                 -> cancelled
```

### 3. 事件和审计

改造方向：

- 所有关键动作写 `audit_logs`。
- 对跨模块动作使用 domain events，例如 `ReportSubmitted`、`AnalysisCompleted`、`AlertAcknowledged`。
- 需要可靠投递时引入 outbox pattern。

收益：

- 可以回放业务过程。
- 可以扩展短信通知、消息推送、大屏联动，不耦合主业务代码。

## 第四阶段：接口契约和前端架构完善

### 1. OpenAPI 作为真实契约

当前问题：

- `backend/src/docs.ts` 只是路径摘要，没有 request/response schema。

改造方向：

- 使用 Zod schema 生成 OpenAPI，或引入 Fastify schema。
- 前端类型从 OpenAPI 自动生成，减少手写类型漂移。
- API 文档标明鉴权、错误码、分页、筛选字段。

### 2. 前端状态和权限治理

当前问题：

- 前端页面各自请求接口。
- 权限只体现在路由守卫，不控制功能按钮。

改造方向：

- 建立 API hooks 或 stores，例如 `useAlertsStore`、`useReportsStore`。
- 根据后端权限返回菜单和按钮能力。
- 列表查询统一分页、筛选、空状态、错误状态。

### 3. 大屏/桌面/移动端分层

当前问题：

- `frontend/src/styles.css:27-29` 固定最小宽度，移动端不可用。

改造方向：

- 明确产品形态：如果是桌面值守平台，则文档写明最低分辨率。
- 如果包含公众上报，则公众入口应独立移动端页面或小程序/H5。
- 管理端和公众端拆路由、拆权限、拆部署边界。

## 第五阶段：模型服务工程化

### 1. 模型注册与版本治理

当前问题：

- 模型名称和权重路径靠约定。
- 结果中缺少模型版本、阈值、训练数据版本、输入数据 hash 等元信息。

改造方向：

- 增加模型注册表：模型名、版本、任务类型、权重路径、阈值、状态、发布时间。
- 每次推理记录模型版本和参数。
- fallback 结果强制标记，不允许进入正式预警发布流程。

### 2. 推理服务接口标准化

建议响应结构：

```json
{
  "taskType": "landslide",
  "model": {
    "name": "LandslideVision",
    "version": "v2.1.0",
    "provider": "pytorch"
  },
  "input": {
    "hash": "...",
    "contentType": "image/jpeg"
  },
  "result": {
    "classification": {},
    "segmentation": {}
  },
  "warnings": []
}
```

### 3. GPU 与批处理准备

改造方向：

- 模型服务容器按 CPU/GPU 分 profile。
- 大文件和批处理走异步任务。
- 对模型服务加健康检查、就绪检查、推理耗时指标。

## 部署与运维完善

### 1. 环境分层

建议环境：

- `local`：开发，允许 demo 数据和 fallback。
- `test`：自动化测试，固定 fixture。
- `staging`：准生产，连接真实依赖但不对外发布。
- `production`：正式环境，禁止默认 secret、禁止演示密码、限制 fallback。

### 2. 可观测性

需要补齐：

- API 请求日志：路由、状态码、耗时、用户、trace id。
- 业务指标：接入成功率、预警数量、任务失败率、模型耗时。
- 错误追踪：后端异常、前端异常、模型服务异常。
- 健康检查：数据库、模型服务、队列、对象存储。

### 3. 数据备份和保留策略

需要明确：

- 数据库备份频率和恢复演练。
- 上传文件和模型输入文件保留周期。
- 群众手机号、图片等敏感数据脱敏和访问控制。
- 审计日志不可随意删除。

### 4. Docker 与 SQLite 运行模式

本次 Docker 验证发现：在 Windows Docker 绑定卷或本地后端开发进程与容器共享同一 SQLite 数据库时，`WAL` journal mode 可能触发 `SQLITE_IOERR_SHMOPEN` 或数据库锁冲突，导致 API 容器启动失败。

已落地处理：

- 后端新增 `SQLITE_JOURNAL_MODE` 配置，仅允许 `wal` 或 `delete`。
- 本地 `docker-compose.yml` 默认使用 `SQLITE_JOURNAL_MODE=delete`，规避 Windows 绑定卷共享内存文件问题。
- 生产 `docker-compose.prod.yml` 默认保持 `wal`，适合 Linux 服务器本地磁盘场景；如生产也使用不支持 WAL 共享内存的挂载，应显式改为 `delete`。
- Docker 与本地开发后端不应长期同时写同一个 `backend/data/geoprophet.db`。需要同时运行时，应改为独立数据库路径或独立 Docker volume。

## 建议里程碑

### M1：演示系统加固

- 生产配置强校验。
- 上传校验、错误处理、基础测试。
- 删除生产环境演示账号暴露。
- AI 调用超时和错误可观测。

### M2：业务闭环成型

- 数据接入接口和质控批次。
- 预警状态机和事件流水。
- 群众上报审核和转预警。
- AI 结果绑定点位/上报/预警。

### M3：生产架构升级

- PostgreSQL/PostGIS。
- migration 体系。
- 任务队列和 worker。
- RBAC、审计日志、OpenAPI 契约。

### M4：平台化能力

- 模型注册与版本治理。
- 大屏/管理端/公众端边界拆分。
- 完整监控、备份、告警和运维手册。

## 推荐优先级

1. 安全配置、上传治理、错误处理、测试。
2. 真实数据接入、预警状态机、群众上报审核。
3. RBAC、审计日志、业务字典、接口契约。
4. PostgreSQL/PostGIS、任务队列、模型版本治理。
5. 多端产品拆分和平台级运维能力。
