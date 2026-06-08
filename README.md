# GeoProphet Web

GeoProphet 当前版本聚焦“群众线索补充 + 航拍图像初筛 + 后台复核”，用于补充政府已有地灾监测体系，而不是重新建设完整地灾数据中心。

## 已实现能力

- 线索总览：待复核线索、带图举证、近期提交趋势和政府参考预警。
- 群众举证：后台可录入群众上报，公开提交页支持免登录提交现场照片、位置和描述。
- 图像初筛：YOLO 模型用于航拍图、无人机照片和巡查图片初筛；豆包视觉可用于移动端现场图片地灾初审。
- 复核留痕：保留识别记录、源文件、模型置信度、风险摘要和处置建议。
- 系统集成：本地账号登录、OIDC 配置占位、REST API、Docker 部署。

## 技术栈

- 前端：Vue 3 + Vite + Element Plus + Pinia + Vue Router + ECharts
- 后端：Fastify + TypeScript + SQLite 演示库 + 文件上传
- 模型服务：FastAPI + PyTorch + Ultralytics YOLO
- 部署：Dockerfile + Docker Compose

## 目录结构

```text
backend/        Fastify API、SQLite 初始化脚本、演示数据
frontend/       Vue 线索补充平台
model-service/  FastAPI + PyTorch/YOLO 模型推理服务
docs/           需求映射与接口说明
docker-compose.yml
```

## 本地启动

1. 安装依赖

```bash
npm install
```

2. 启动前后端开发环境

```bash
npm run dev
```

如需连通真实 YOLO 模型服务，可额外启动：

```bash
docker compose up --build model-service
```

如需启用豆包视觉，先在当前 PowerShell 会话设置火山方舟 API Key，再启动：

```powershell
$env:ARK_API_KEY="你的火山方舟 API Key"
npm run doubao:dev
```

`npm run doubao:dev` 会把 `VISION_PROVIDER=doubao`、火山方舟 OpenAI-compatible 地址和默认模型写入当前进程环境，不会把 API Key 写入项目文件。模型 ID 可按控制台开通情况调整：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-doubao-local.ps1 -Model "你的模型 ID"
```

3. 访问地址

- 前端：`http://localhost:5173`
- 后端：`http://localhost:3000`
- API 文档：`http://localhost:3000/api/docs`
- 模型服务：`http://localhost:8000/docs`
- 公开提交页：`http://localhost:5173/submit`

## 图像初筛定位

YOLO 模型只作为“航拍图像/无人机照片/巡查照片”的初步识别工具，用于快速标出疑似滑坡区域、风险分数和复核建议。结果不能替代人工核查，也不直接触发正式预警。

生产环境应配置：

```dotenv
AI_INFERENCE_BASE_URL=http://model-service:8000
AI_LANDSLIDE_ENDPOINT=/predict/landslide
LANDSLIDE_YOLO_PATH=/app/models/yolo_landslide_from_masks/yolov8n_640/weights/best.pt
```

豆包视觉通过后端代理接入，API Key 只保存在后端环境变量中，不会下发给浏览器：

```dotenv
VISION_PROVIDER=doubao
VISION_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
VISION_CHAT_ENDPOINT=chat/completions
VISION_MODEL=你的火山方舟视觉模型 ID
ARK_API_KEY=你的火山方舟 API Key
```

当前“照片初筛”页面可在“本地 YOLO”和“豆包视觉”之间切换。豆包视觉未配置完整时，前端会显示配置状态并禁用豆包模式。

## 演示账号

仅 `APP_MODE=demo` 的本地演示环境会初始化并展示以下账号：

- `admin / admin123`
- `operator / operator123`
- `expert / expert123`

生产环境不会创建或允许继续使用这些默认凭据，首个管理员通过 `.env.production` 中的 `INITIAL_ADMIN_USERNAME` 和 `INITIAL_ADMIN_PASSWORD` 配置。

## Docker 启动

```bash
docker compose up --build
```

启动后访问：

- 前端：`http://localhost:8080`
- 后端：`http://localhost:3000`
- 模型服务：`http://localhost:8000`

## 关键接口

- `POST /api/auth/login`
- `GET /api/dashboard/overview`
- `GET /api/sites`
- `GET /api/sites/:id`
- `GET /api/alerts`
- `PATCH /api/alerts/:id/ack`
- `GET /api/reports`
- `POST /api/reports`
- `POST /api/uploads`
- `GET /api/analysis/models`
- `GET /api/analysis/assessments`
- `GET /api/analysis/runs`
- `POST /api/analysis/landslide`
- `POST /api/analysis/mobile-image`
- `GET /api/system/vision-config`

## 说明

- 当前版本不再接入地灾数据中心、NASA/USGS 公开地灾图层、PostGIS 空间主库或 NASA GIBS 每日遥感同步。
- 当前版本是面向联调和演示的轻量 MVP，业务数据来自内置 SQLite 初始化脚本 [backend/db/init.sql](/d:/hicool/backend/db/init.sql)。
- `POST /api/analysis/landslide` 是 YOLO 照片初筛接口，由后端转发到 FastAPI/YOLO 模型服务。
- `POST /api/analysis/mobile-image` 是豆包视觉图片识别接口，由后端调用火山方舟兼容 Chat Completions API 并归一化为平台识别记录。
- OIDC 单点登录入口已在接口与前端界面预留，接入真实身份源时补充环境变量即可扩展。
