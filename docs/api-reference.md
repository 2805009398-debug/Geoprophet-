# API 参考

## 认证

- `GET /api/auth/providers`
- `POST /api/auth/login`
- `GET /api/auth/me`

## 总览与系统

- `GET /api/health`：依赖正常返回 200；依赖降级返回 503。
- `GET /api/dashboard/overview`
- `GET /api/system/logs`
- `GET /api/system/audit-logs`
- `GET /api/system/migrations`
- `GET /api/system/domain-events`

## 监测点与预警

- `GET /api/sites`
- `GET /api/sites/:id`
- `GET /api/alerts`
- `POST /api/alerts`
- `PATCH /api/alerts/:id/ack`

## 群众上报

- `GET /api/reports`：登录后查看群众线索列表，返回上报信息、图片、状态、置信度，以及已绑定的豆包初审字段。
- `POST /api/reports`：提交群众线索。无图线索可直接提交；带图线索必须携带 `imageUrl` 和匹配的 `aiAnalysisRunId`。
- `POST /api/uploads`：上传群众现场图片，后端会保存图片、调用豆包视觉模型、写入 `analysis_runs`，返回 `{ url, analysis }`。

`POST /api/reports` 请求示例：

```json
{
  "reporterName": "王师傅",
  "phone": "13800001234",
  "title": "村口公路旁新裂缝",
  "reportType": "裂缝",
  "description": "今天上午发现路边坡脚有新裂缝，雨后有少量落石。",
  "imageUrl": "/uploads/1760000000000-abcd1234.jpg",
  "aiAnalysisRunId": 12,
  "lat": 41.95,
  "lng": 126.95
}
```

`POST /api/uploads` 返回示例：

```json
{
  "url": "/uploads/1760000000000-abcd1234.jpg",
  "analysis": {
    "id": 12,
    "provider": "vision-llm",
    "modelName": "doubao-seed-2-0-lite-260215",
    "confidence": 0.82,
    "summary": "图片中可见疑似坡体滑移和裸露土体。",
    "riskAssessment": {
      "riskLevel": "high",
      "riskScore": 0.78,
      "label": "高风险",
      "recommendedAction": "尽快安排专业人员现场复核。",
      "reviewRequired": true
    }
  }
}
```

## 航拍图像初筛

- `GET /api/analysis/models`
- `GET /api/analysis/assessments`
- `GET /api/analysis/runs`
- `POST /api/analysis/landslide`：YOLO 航拍图、无人机照片和巡查照片初筛。
- `POST /api/analysis/mobile-image`：登录后的视觉大模型图片识别入口，结果写入 `analysis_runs`，不自动绑定群众线索。
- `GET /api/requirements`

## 模型服务

- `GET /health`
- `POST /predict/landslide`
