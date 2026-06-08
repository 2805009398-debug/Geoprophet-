# GeoProphet 项目代码分析

分析时间：2026-05-25。  
分析范围：Git 跟踪的源码、配置、部署和文档文件。明确排除生成物/第三方/运行时文件：`node_modules/`、`.tools/`、`backend/dist/`、`frontend/dist/`、`__pycache__/`、`backend/data/`、上传文件、模型权重文件。

验证结果：

- `npm run build` 通过：后端 `tsc`、前端 `vue-tsc --noEmit` 与 `vite build` 均成功。
- `python -m compileall model-service/app` 通过：Python 模型服务语法可编译。
- 仓库当前没有自动化测试用例，所以下面结论来自逐文件静态阅读与构建验证。

## 总体结构

- `package.json:1-17` 定义 npm workspaces：`frontend` 和 `backend`；根脚本负责并行开发、串行构建和启动后端。
- `README.md:1-71` 说明项目是 GeoProphet Web MVP，包含前端监测平台、Fastify 后端和 FastAPI/PyTorch 模型服务。
- `backend/` 是 Fastify + TypeScript + SQLite API。
- `frontend/` 是 Vue 3 + Vite + Element Plus + Pinia + ECharts + Leaflet 前端。
- `model-service/` 是 FastAPI 模型推理服务，支持滑坡识别和 InSAR 冰川分割。
- `docker-compose*.yml` 与 `deploy/Caddyfile` 负责本地、生产 HTTP、生产 HTTPS 三种部署路径。

## 后端逐文件分析

### `backend/src/config.ts`

- `1` 引入 Node `path`。
- `3` 用 `__dirname` 计算运行根目录；在源码运行时是 `backend`，编译运行时也是 `backend`，路径设计成立。
- `5-11` 集中定义数据库、初始化 SQL、上传目录、分析上传目录。
- `13-24` 从环境变量生成运行配置；`16` 在缺省时使用演示 JWT secret，生产环境必须覆盖；`17-20` 只做 OIDC 配置占位；`21-23` 配置外部 AI 推理服务与端点。

### `backend/src/server.ts`

- `1-16` 注册 Fastify 插件和业务路由依赖。
- `18-21` 启动 Fastify，挂载 SQLite 实例和配置对象。
- `23` CORS 允许任意 origin 且带 credentials，演示阶段方便，生产应收紧。
- `24` 注册 JWT。
- `25-30` multipart 限制单文件、最大 10MB。
- `31-34` 把 `backend/uploads` 暴露为 `/uploads/` 静态资源。
- `36` 健康检查接口 `/api/health`。
- `38-46` 依次挂载认证、总览、点位、预警、上报、研判、系统、文档路由。
- `48-51` 全局错误处理统一返回 500；这会把部分 Zod 参数错误也包装成 500。
- `53-59` 监听端口，启动失败直接退出进程。

### `backend/src/db.ts`

- `1-5` 引入文件系统、路径、SQLite 和密码工具。
- `7-11` 定义三个演示账号。
- `13-20` 创建数据目录、上传目录，打开 SQLite，并启用外键与 WAL。
- `22-29` 用 `sites` 表是否存在判断是否执行 `init.sql`。
- `31-33` 补运行期 schema、种子用户后返回数据库实例。
- `36-50` 兜底创建 `analysis_runs`。
- `52-67` `INSERT OR IGNORE` 补充 `GlacierSAR-Net` 模型记录。
- `70-95` 仅当 `users` 为空时写入演示账号，密码用 scrypt 哈希。

### `backend/src/password.ts`

- `1` 使用 `randomBytes`、`scryptSync`、`timingSafeEqual`。
- `3-7` 创建 16 字节随机盐和哈希。
- `9-11` 用 scrypt 生成 64 字节哈希。
- `13-20` 验证密码，长度不同直接失败，长度一致时用 timing-safe 比较。

### `backend/src/guards.ts`

- `1` 引入 Fastify 请求/响应类型。
- `3-8` JWT 校验失败返回 401；成功时 Fastify JWT 会把用户载荷挂到 `request.user`。

### `backend/src/docs.ts`

- `1-26` 用静态数组描述需求覆盖项。
- `28-58` 提供简化 OpenAPI catalog，只有路径摘要，没有完整 schema。

### `backend/src/types.d.ts`

- `1-21` 扩展 Fastify 实例，声明 `db` 与 `appConfig`。
- `23-38` 扩展 JWT payload/user 类型，字段与登录签发内容一致。

### `backend/src/routes/auth.ts`

- `6-9` 登录请求只校验用户名/密码非空。
- `11-18` 把数据库用户行映射为前端用户结构。
- `21-36` 暴露登录方式和演示账号；这会把演示密码通过接口返回。
- `38-58` 登录：校验 body、查询用户、验证密码、签发 JWT。
- `60-63` `/api/auth/me` 依赖 JWT 查询用户；如果数据库里用户被删除，`mapUser(undefined)` 会抛错并变成 500。

### `backend/src/routes/dashboard.ts`

- `4-25` 生成 7 天趋势；`5` 固定结束日期为 `2026-04-24`，与真实当前日期脱钩，但与演示数据匹配。
- `27-131` `/api/dashboard/overview` 聚合统计、分布、地图点位、最新预警、系统事件和接入状态。
- `8-13` SQL 表名来自 TypeScript union 限定的内部参数，不直接来自用户输入。

### `backend/src/routes/sites.ts`

- `5-9` 查询参数 schema 允许风险、状态、关键词。
- `12-64` 点位列表：动态拼 `WHERE`，但条件值都走参数绑定；`30` 只拼条件片段。
- `66-89` 点位详情读取并处理 404。
- `91-105` 查询传感器。
- `107-124` 查询最近 24 条观测。
- `126-141` 查询最新影响评估。
- `13` 和 `67` 使用 `parse`，参数错误会抛 ZodError，由全局错误处理映射为 400 并返回 requestId。

### `backend/src/routes/alerts.ts`

- `5-12` 新增预警 schema，限制等级枚举。
- `15-52` 预警列表，过滤条件参数绑定。
- `54-99` 新增预警；会预检查 `siteId` 是否存在，并写入审计和领域事件。
- `71-82` 确认预警，按 id 更新状态，不存在返回 404。

### `backend/src/routes/reports.ts`

- `9-19` 群众上报 schema；经纬度用 `z.coerce.number()`。
- `22-46` 上报列表需要登录。
- `48-70` 新增群众上报不需要登录，适合公众入口；置信度是 `0.55-0.90` 的随机演示值。
- `72-84` 上传接口不需要登录，保存单文件并返回 `/uploads/...`；通过 `uploads.ts` 校验 MIME、扩展名和文件头，无扩展名时按真实格式推断安全后缀。

### `backend/src/routes/analysis.ts`

- `6-16` 模型库列表。
- `18-38` 影响评估列表。
- `40-45` 最近识别任务，limit 限制在 `1-20`。
- `47-55` 滑坡图片识别上传。
- `57-65` 冰川 InSAR 识别上传。

### `backend/src/routes/system.ts`

- `5-27` 系统日志接口，支持 category 过滤。`parse` 抛出的 ZodError 会被全局错误处理映射为 400。

### `backend/src/routes/docs.ts`

- `4-7` 暴露 `/api/docs` 与 `/api/requirements`，不需要登录。

### `backend/src/services/hazard-analysis.ts`

- `10-47` 定义任务类型、服务类型、点、分割区域、分类结果和统一预测结构。
- `57-68` 识别入口：保存上传文件，demo 模式可在未配置 `AI_INFERENCE_BASE_URL` 时走 mock；production 启动阶段强制要求外部模型服务地址。
- `70-92` 查询最近任务，只返回摘要字段，不返回完整 `result_json`。
- `94-108` 保存分析上传文件；通过 `uploads.ts` 校验扩展名、MIME 和文件头后再落盘。
- `110-147` 外部推理：把文件包装成 `FormData` 后调用模型服务，使用 `AbortController` 按 `AI_INFERENCE_TIMEOUT_MS` 超时取消；仍没有重试/熔断。
- `140-206` mock 推理：基于文件 hash 生成稳定伪结果，滑坡含分类+可选分割，冰川固定返回两个区域。
- `208-276` 归一化外部模型输出，支持 camelCase 和部分 snake_case 字段。
- `278-293` 优先使用外部 segmentation，否则从 mask 生成区域。
- `295-315` 归一化 polygon 点，坐标被 clamp 到 0-1。
- `317-361` 从二维 mask 计算外接矩形区域。
- `363-376` 把 mask 值转数字矩阵。
- `378-400` 计算 mask 覆盖率。
- `402-420` 生成 mock polygon。
- `422-452` 把预测结果写入 `analysis_runs`，完整 JSON 存 `result_json`。
- `454-483` hash seed、clamp 和 SQL 时间格式工具。

### `backend/db/init.sql`

- `1-135` 建表：用户、点位、传感器、观测、预警、群众上报、模型、评估、识别任务、日志。
- `137-143` 6 个白山市演示点位。
- `145-157` 12 个传感器。
- `159-195` 36 条观测数据。
- `197-203` 6 条预警。
- `205-210` 5 条群众上报。
- `212-217` 5 个算法模型。
- `219-223` 4 条影响评估。
- `230-240` 10 条系统日志。

## 模型服务逐文件分析

### `model-service/app/config.py`

- `8-20` `Settings` 集中描述模型目录、设备、fallback 开关、权重路径和阈值。
- `22-25` 环境变量转 bool。
- `28-49` 从环境变量读取设置，默认模型目录是 `model-service/models`，默认关闭启发式 fallback；本地 compose 会显式开启 demo fallback。

### `model-service/app/main.py`

- `14-26` 用 `lru_cache` 单例化设置和模型服务。
- `29-33` lifespan 启动时加载服务。
- `36-41` 创建 FastAPI 应用。
- `44-60` 健康检查返回模型加载情况、设备、fallback 状态和 warning。
- `63-72` 滑坡预测接口：读取文件、拒绝空文件、调用服务，异常统一转 400。
- `75-84` 冰川预测接口，同样异常统一转 400。

### `model-service/app/schemas.py`

- `8-21` 定义 polygon、region、segmentation 响应结构。
- `23-29` 定义分类结构，允许 `hasHazard` alias。
- `31-42` 定义预测公共字段，使用 `taskType/modelName` alias。
- `44-47` 滑坡响应包含 classification、hasLandslide、mask。
- `50-51` 冰川响应包含 glacierMask。
- `54-61` 健康检查响应结构。

### `model-service/app/utils.py`

- `11-12` 读取普通图片为 RGB。
- `15-29` 读取 InSAR 图片，保留/补齐两个通道并归一化。
- `32-45` 按通道做 2%-98% 分位归一化。
- `48-67` 从 mask 生成外接矩形 polygon。
- `70-72` 用 sha1 生成稳定 seed。
- `75-92` 生成椭圆启发式 mask。

### `model-service/app/services/landslide.py`

- `15-21` 描述滑坡分类器和分割器工件。
- `23-42` 初始化设备、分类预处理、分割预处理并加载模型。
- `44-47` ready 条件是分类器和分割器都存在。
- `48-58` 预测入口：权重齐全走真实模型，否则按配置走 fallback 或抛错。
- `60-126` 真实模型推理：先 ResNet18 二分类，判为滑坡后再 UNet 分割。
- `128-155` fallback 推理：基于文件内容生成稳定演示结果，并带 warning。
- `157-188` 加载权重；缺失时返回 warning，不阻断服务。
- `190-197` 设备选择，`auto` 优先 CUDA，CUDA 不可用回退 CPU。

### `model-service/app/services/glacier.py`

- `13-17` 描述冰川分割器工件。
- `19-23` 初始化设备并加载模型。
- `25-38` 预测入口，缺权重时可 fallback。
- `40-67` 真实 UNet 分割，输出 mask、覆盖率和 polygon。
- `69-90` fallback 推理。
- `92-106` 加载 `GlacierSAR-Net` 分割权重。
- `108-114` 设备选择逻辑。

## 前端逐文件分析

### `frontend/src/types.ts`

- `1-23` 用户和登录提供方类型。
- `25-70` dashboard 统计、分布、趋势、地图点和总览类型。
- `72-126` 点位、传感器、观测、评估、点位详情类型。
- `128-156` 预警和群众上报类型。
- `158-186` 模型、系统日志类型。
- `188-235` 预测 polygon、预测结果和历史识别记录类型。

### `frontend/src/lib/api.ts`

- `3-4` API base 默认 `/api`，并推导静态资源 origin。
- `6-9` axios 实例固定 8 秒超时；模型推理较慢时可能误报失败。
- `11-17` 从 localStorage 注入 Bearer token。
- `19-29` 把相对上传 URL 转成绝对可访问 URL。

### `frontend/src/router/index.ts`

- `14-36` 定义登录页和登录后的 AppShell 子路由。
- `38-58` 路由守卫：有 token 无 user 时请求 `/auth/me`；需要登录但无 token 时跳转登录；已登录访问登录页时回首页。

### `frontend/src/stores/auth.ts`

- `12-18` Pinia auth 状态，token 从 localStorage 恢复。
- `23-27` 拉取登录方式和演示账号。
- `28-33` 登录后保存 token 和用户。
- `34-41` 根据 token 获取当前用户。
- `42-46` 清空登录态。

### `frontend/src/components/AppShell.vue`

- `21-29` 侧边栏菜单。
- `31-40` 当前路由和打开 API 文档方法。
- `43-93` 布局、菜单、顶部栏、用户下拉和子页面出口。

### `frontend/src/components/SiteMap.vue`

- `1-12` 初始化 Leaflet 依赖和引用。
- `14-54` 渲染点位 marker；`40-45` popup 用模板字符串拼 HTML，未做转义。
- `56-71` 创建地图和 OSM 底图。
- `73-79` 点位变化时重绘 marker。
- `81-84` 卸载地图。

### `frontend/src/views/DashboardView.vue`

- `20-28` 获取总览。
- `30-86` 构造预警趋势、上报趋势、风险结构图表配置。
- `88-93` 预警等级到标签类型映射。
- `95-208` 页面展示统计、地图、图表、最新预警、系统事件。

### `frontend/src/views/SitesView.vue`

- `22-31` 点位列表查询。
- `33-45` 打开详情抽屉。
- `47-92` 将观测数据按传感器分组并生成 ECharts 配置。
- `94-105` 风险和状态 tag 映射。
- `107-238` 页面、筛选、表格、详情抽屉、传感器趋势和评估卡片。

### `frontend/src/views/DataCenterView.vue`

- `10-22` 并行拉 dashboard 和 ingestion 日志。
- `24-45` 构造四类接入通道卡片。
- `47-136` 页面展示接入指标、通道状态、处理流程、日志表。

### `frontend/src/views/AlertsView.vue`

- `26-35` 获取预警列表。
- `37-40` 获取点位列表供新增预警选择。
- `42-46` 确认预警，没有 try/catch。
- `48-66` 创建预警并重置表单。
- `68-78` 标签类型映射。
- `80-180` 页面、筛选、列表和新增预警弹窗。

### `frontend/src/views/ReportsView.vue`

- `11-21` 群众上报表单默认值。
- `23` 上传地址使用 `/api/uploads`。
- `25-37` 并行获取上报列表和点位。
- `39-48` 选择点位时同步经纬度。
- `50-53` 上传成功写入图片 URL。
- `55-75` 提交上报。
- `77-83` 状态标签映射与页面加载。
- `86-207` 页面、表单、图片上传、质控流程和上报队列。

### `frontend/src/views/AnalysisView.vue`

- `27-41` 并行获取模型、评估和识别历史。
- `43-51` 模型状态和任务名格式化。
- `53-73` 文件选择与预览 URL 管理。
- `75-89` 清空选择和 TIFF 预览判断。
- `91-99` polygon/metadata 格式化。
- `101-133` 识别请求，使用 multipart 上传到 `/analysis/landslide` 或 `/analysis/glacier`。
- `135-138` 刷新最近识别记录。
- `140-150` 挂载加载数据，卸载释放 object URL。
- `153-358` 页面、两个识别工作台、结果叠加展示、历史记录、模型库、影响评估。

### `frontend/src/views/LoginView.vue`

- `11-15` 登录表单默认留空，避免生产界面预填演示凭据。
- `17-18` 读取 OIDC 是否启用，并根据接口返回判断是否展示演示账号区。
- `20-32` 登录动作。
- `34-37` 点击演示账号填充表单，仅 demo 模式会有按钮。
- `39-45` 加载登录提供方。
- `48-127` 登录页、OIDC 占位按钮、demo 条件展示的演示账号按钮。

### `frontend/src/styles.css`

- `1-21` 全局颜色变量和背景。
- `27-33` `body` 固定 `min-width: 1280px`，小屏不会真正响应式。
- `43-172` Shell、侧边栏、顶部栏、卡片基础样式。
- `191-213` 栅格工具类。
- `215-266` 统计卡、图表、地图尺寸。
- `304-360` 登录页样式。
- `379-423` 传感器、通道、模型等卡片样式。
- `425-513` 分析工作台、预览图、SVG overlay、metadata 样式。
- `515-529` 只在小于 1400px 时把部分栅格变两列，并把 body `min-width` 降到 1120px；没有手机布局。

## 部署与配置分析

- `frontend/vite.config.ts:8-21` 开发服务代理 `/api` 和 `/uploads` 到后端，生产由 Nginx 代理。
- `frontend/nginx.conf:8-10` SPA fallback 正确；`17-33` 代理 API 和上传资源到 `api:3000`。
- `backend/Dockerfile:1-32` 多阶段构建后端，生产只安装后端 workspace 依赖，复制 dist/db/uploads。
- `frontend/Dockerfile:1-21` 多阶段构建前端，最终用 Nginx 托管。
- `model-service/Dockerfile:1-19` Python 3.11 slim，安装 PyTorch/torchvision/segmentation-models-pytorch，默认 CPU 且关闭 fallback。
- `docker-compose.yml:1-41` 本地三服务：model-service、api、web；api 通过 `AI_INFERENCE_BASE_URL=http://model-service:8000` 调模型。
- `docker-compose.prod.yml:1-65` 生产 HTTP 版，加入 healthcheck 和 restart。
- `docker-compose.https.yml:65-83` 增加 Caddy 网关和证书持久卷。
- `deploy/Caddyfile:1-4` 通过 `APP_DOMAIN` 反代到 web。
- `.env.production.example:1-8` 给出生产环境变量模板。
- `.gitignore:1-32` 忽略依赖、工具、dist、数据库、上传文件、模型权重和生产 env。

## 明确问题与风险

1. 生产安全风险已完成第一轮加固，但仍缺少账号生命周期能力。
   - 证据：`backend/src/config.ts` 在 production 拒绝默认/占位/过短 `JWT_SECRET` 并要求 `CORS_ORIGINS`；`backend/src/db.ts` 只在 demo 模式写入演示账号，production 会拦截默认演示凭据；`frontend/src/views/LoginView.vue` 不再预填演示密码。
   - 剩余影响：生产首个管理员依赖环境变量创建，后续仍需要补“修改密码、重置密码、禁用账号、密码策略”。

2. 上传接口已补基础文件类型验证，仍缺少内容安全扫描。
   - 证据：`backend/src/uploads.ts` 统一校验扩展名、MIME 和 jpg/png/webp/tiff 文件头；群众上报和 AI 分析上传都复用该模块。
   - 剩余影响：目前能拦截伪造图片头的常见风险，但还没有杀毒扫描、图片解码重编码、对象存储隔离和生命周期清理。

3. 外部模型调用已增加超时，仍是同步 HTTP 任务。
   - 证据：`backend/src/services/hazard-analysis.ts` 使用 `AbortController` 和 `AI_INFERENCE_TIMEOUT_MS`；`frontend/src/lib/api.ts` 为分析接口使用更长 timeout。
   - 剩余影响：模型推理仍会占用一次 HTTP 请求，后续应迁移为任务队列、进度查询和结果回调。

4. 通用错误处理已补基础映射，但接口契约仍需统一。
   - 证据：`backend/src/errors.ts` 提供 `HttpError`；`backend/src/server.ts` 对 ZodError、文件过大、外键错误和上游错误做统一响应。
   - 剩余影响：部分路由仍有手写 `{ message }` 响应，后续应统一响应结构和 OpenAPI schema。

5. `/api/auth/me` 已处理用户不存在场景。
   - 证据：`backend/src/routes/auth.ts` 查询不到当前用户时抛出 404，而不是继续 `mapUser(undefined)`。
   - 剩余影响：仍需要 token 失效策略和服务端会话/黑名单能力。

6. Dashboard 趋势日期固定。
   - 证据：`backend/src/routes/dashboard.ts:5` 固定 `2026-04-24T00:00:00`。
   - 影响：演示数据能稳定展示，但真实运行不会随日期滚动。

7. 前端移动端不可用。
   - 证据：`frontend/src/styles.css:27-29` 固定最小宽度 1280px；`515-529` 只降到 1120px。
   - 影响：手机和平板会横向滚动，不是响应式平台。

8. 地图 popup 未转义。
   - 证据：`frontend/src/components/SiteMap.vue:40-45` 用模板字符串拼 HTML。
   - 影响：当前点位来自种子数据风险低；如果未来允许用户维护点位名称/类型，需要转义避免 XSS。

9. OIDC 只是占位，不是可用登录链路。
   - 证据：`backend/src/config.ts:17-20` 只有配置字段；`backend/src/routes/auth.ts:21-36` 只返回 provider 状态；`frontend/src/views/LoginView.vue:103-106` 按钮无实际跳转。
   - 影响：文案中“预留”准确，但不能宣称已接入统一认证。

## 可优先修复顺序

1. 账号体系：在现有 production 初始管理员基础上，补修改密码、禁用账号、密码策略和审计查询页面。
2. 上传链路：在 MIME/扩展名/文件头校验基础上，补图片解码重编码、对象存储隔离、上传鉴权或更细限流。
3. 错误处理：继续收敛手写响应，形成稳定错误码和 OpenAPI schema。
4. AI 推理：从同步 HTTP 调用演进为任务队列、进度查询、失败重试和结果回调。
5. 数据日期：将 dashboard 趋势改为基于最新数据日期或当前日期可配置。
6. 前端体验：补移动端布局，或者在需求中明确只支持桌面大屏。
