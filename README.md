# GeoProphet Web

基于你提供的《GeoProphet 商业计划书》和《地质灾害监测系统开发部署-服务要求》提炼实现的 Web 版 MVP，包含前端监测平台与后端 REST API。

## 已实现能力

- 地灾监测数据接收与管理：监测点、传感器、观测值、系统日志、数据接收状态
- 地灾灾情监测与分析：算法模型库、影响评估结果、活动预警中心
- 地灾监测综合可视化：白山市点位地图、趋势图表、预警态势、应急预案
- 公众参与：群众上报表单、图片上传、AI 初审置信度占位逻辑
- 系统集成：本地账号登录、OIDC 配置占位、标准 REST API、Docker 部署

## 技术栈

- 前端：Vue 3 + Vite + Element Plus + Pinia + Vue Router + ECharts + Leaflet
- 后端：Fastify + TypeScript + SQLite + 文件上传
- 部署：Dockerfile + Docker Compose

## 目录结构

```text
backend/      Fastify API、SQLite 初始化脚本、演示数据
frontend/     Vue 监测平台
model-service/FastAPI + PyTorch 模型推理服务
docs/         需求映射与接口说明
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

如需连通真实模型服务，可额外启动：

```bash
docker compose up --build model-service
```

3. 访问地址

- 前端：`http://localhost:5173`
- 后端：`http://localhost:3000`
- API 文档：`http://localhost:3000/api/docs`
- 模型服务：`http://localhost:8000/docs`

## 演示账号

- `admin / admin123`
- `operator / operator123`
- `expert / expert123`

## Docker 启动

```bash
docker compose up --build
```

启动后访问：

- 前端：`http://localhost:8080`
- 后端：`http://localhost:3000`

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
- `POST /api/analysis/glacier`
- `GET /api/plans`

## 说明

- 当前版本是面向联调和演示的 MVP，数据来自内置 SQLite 初始化脚本 [backend/db/init.sql](/d:/hicool/backend/db/init.sql)。
- 智能识别接口默认使用内置演示推理逻辑；如需接入真实 PyTorch/FastAPI 模型服务，可配置 `AI_INFERENCE_BASE_URL`，并由后端自动转发到滑坡与冰川识别端点。
- 模型服务权重默认放在 [model-service/models](/d:/hicool/model-service/models) 下，文件名约定为 `landslide_clf.pth`、`landslide_seg.pth`、`glacier_insar_unet.pth`。
- OIDC 单点登录入口已在接口与前端界面预留，接入真实身份源时补充环境变量即可扩展。
- 前端打包已通过，后端 TypeScript 构建已通过。
