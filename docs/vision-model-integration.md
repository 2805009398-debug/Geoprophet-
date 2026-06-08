# 移动端图片识别视觉大模型接入说明

## 目标

平台有两条视觉大模型入口：

- `POST /api/uploads`：公开提交页和后台代录页使用。后端保存群众现场照片后立即调用图片预警初审，把结果写入 `analysis_runs`，再返回 `{ url, aiAnalysisRunId, analysis }`。前端提交群众线索时必须把 `aiAnalysisRunId` 一起传给 `POST /api/reports`。
- `POST /api/analysis/mobile-image`：登录后的可选视觉大模型识别接口，可由移动巡查或智能研判工作台挂载。巡查人员拍照或从相册选择图片后，调用视觉大模型做地质灾害初筛，结果同样写入 `analysis_runs`，但不自动绑定群众线索。

两条入口最终都会归一化为平台统一的 `HazardPrediction`，前端可展示模型、来源、置信度、风险等级、风险分数、摘要、处置建议和可见线索。群众上报的标题和现场描述还会进入滑坡前兆规则初筛，用于补充图片无法判断的地下水、声响、动物异常等线索。

## 推荐接入：豆包 / 火山方舟

火山方舟提供对话 API、API Key 鉴权和豆包视觉理解模型能力。平台按 OpenAI-compatible Chat Completions 结构向后端供应商发起请求，图片以 `data:image/...;base64,...` 形式放入 `image_url.url`，API Key 只在后端环境变量中使用，不会下发给浏览器。

本地 PowerShell 示例：

```powershell
$env:ARK_API_KEY="你的火山方舟 API Key"
npm run doubao:dev
```

如果你的账号开通的是其他模型 ID，可以显式传入：

```powershell
$env:ARK_API_KEY="你的火山方舟 API Key"
powershell -ExecutionPolicy Bypass -File .\scripts\start-doubao-local.ps1 -Model "你的模型 ID"
```

生产 `.env.production` 示例：

```dotenv
VISION_PROVIDER=doubao
VISION_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
VISION_CHAT_ENDPOINT=chat/completions
VISION_MODEL=你的火山方舟视觉模型 ID
VISION_API_KEY=
ARK_API_KEY=
VISION_TIMEOUT_MS=45000
```

`VISION_MODEL` 应以你在火山方舟控制台开通的模型 ID 为准；不同账号、地域和模型版本可能不同。后端会优先读取 `VISION_API_KEY`，也兼容 `ARK_API_KEY` 和 `DOUBAO_API_KEY`。

### 本地 Docker 示例

本地 `docker-compose.yml` 已经把 `VISION_*`、`ARK_API_KEY` 透传给 API 容器。启动前在当前 PowerShell 会话设置：

```powershell
$env:VISION_PROVIDER="doubao"
$env:VISION_MODEL="你的火山方舟视觉模型 ID"
$env:ARK_API_KEY="你的火山方舟 API Key"
docker compose up --build
```

## DeepSeek 说明

DeepSeek 官方 API 当前适合接入文本对话、推理、JSON 输出、工具调用等能力。官方 Anthropic 兼容说明中，消息内容的 `array, type="image"` 标记为 `Not Supported`。因此本平台保留 `VISION_PROVIDER=deepseek` 配置值，但移动端图片识别会直接返回“DeepSeek 官方 API 当前未提供稳定图片输入能力”的提示。

如果未来 DeepSeek 官方 API 发布稳定图片输入接口，只需要在 `backend/src/services/hazard-analysis.ts` 中新增对应 provider 分支，保持输出归一化为现有 `HazardPrediction` 即可。

## 前端使用方式

### 公开提交和后台代录

1. 用户在 `/submit` 或后台 `/reports` 中选择现场图片。
2. 前端调用 `POST /api/uploads`。
3. 后端校验图片、保存文件、调用豆包视觉模型或本地图片模型，并写入 `analysis_runs`。
4. 前端展示图片预警初审卡片，并在表单状态中保存 `imageUrl` 和 `aiAnalysisRunId`。
5. 用户提交线索时，前端调用 `POST /api/reports`，带图线索必须携带匹配的 `imageUrl` 和 `aiAnalysisRunId`。

后端会校验 `analysis_runs.source_url` 是否等于提交的 `imageUrl`，避免初审结果和图片错绑。同时会扫描标题和现场描述中的滑坡预警前兆，包括裂缝急剧扩展、地下水异常、坡脚隆起、异常声响、零星落石或小型崩塌、树木房屋或动物异常；文字前兆风险会和图片初审风险合并，取更高风险进入复核队列。

### 可选登录端识别入口

1. 在登录后的业务页面或移动巡查入口选择视觉大模型识别能力。
2. 拍照或从相册选择图片。
3. 手机端点击“拍照”会优先调起后置摄像头；也可点击“选择图片”从相册上传。
4. “照片初筛”页面会通过 `GET /api/system/vision-config` 获取豆包配置状态；配置完整时可切换到“豆包视觉”。
5. 点击“开始识别”后，前端调用 `/api/analysis/mobile-image`。

移动端视觉入口仅支持常见图片格式：jpg、jpeg、png、webp。TIFF/GeoTIFF 仍保留给原来的 `/api/analysis/landslide` 本地模型链路。

## 返回结构

视觉模型需要返回严格 JSON。后端会解析并归一化为平台统一结构：

```json
{
  "hasHazard": true,
  "confidence": 0.82,
  "riskLevel": "high",
  "riskScore": 0.78,
  "hazardType": "landslide",
  "summary": "图片中可见疑似坡体滑移和裸露土体。",
  "regions": [
    {
      "label": "疑似滑坡区域",
      "score": 0.8,
      "polygon": [
        { "x": 0.18, "y": 0.32 },
        { "x": 0.74, "y": 0.33 },
        { "x": 0.70, "y": 0.78 },
        { "x": 0.22, "y": 0.76 }
      ]
    }
  ],
  "warningSigns": ["坡体后缘弧形裂缝", "坡脚隆起"],
  "observations": ["裸露土体", "坡脚堆积", "植被破坏"],
  "evidence": ["坡面裸露且边界清晰", "坡脚有堆积物"],
  "recommendedAction": "建议安排现场巡查并结合雨量、位移数据复核。"
}
```

坐标采用 0 到 1 的相对比例，`x` 从左到右，`y` 从上到下。如果模型无法可靠定位区域，应返回空 `regions`。

`riskScore` 使用 0 到 1 的小数；`riskLevel` 取 `low`、`medium`、`high`、`critical`。如果模型未返回风险字段，后端会根据 `hasHazard`、置信度、区域分数和证据数量计算兜底风险评估。

## 安全与运维注意事项

- 不要把 `VISION_API_KEY` 写入前端代码或提交到 Git。
- 生产环境建议限制上传图片大小，并在平台外侧加 HTTPS。
- 视觉大模型结果只能作为初筛，不能替代专业人员现场复核。
- 如果用于真实预警，建议把识别结果进入人工复核流程，再触发正式预警。
- 公开入口已有限流；生产环境仍建议增加验证码、内容安全审核、图片重编码和对象存储隔离。
