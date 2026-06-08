# 模型服务说明

## 目录

- `model-service/app/main.py`：FastAPI 入口
- `model-service/app/services/landslide.py`：滑坡分类 + 分割推理
- `model-service/models/`：模型权重目录

## 默认接口

- `GET /health`
- `POST /predict/landslide`

## 权重文件约定

将以下权重文件放入 `model-service/models/`：

- `landslide_clf.pth`
- `landslide_seg.pth`

也可以通过环境变量覆盖：

- `LANDSLIDE_CLASSIFIER_PATH`
- `LANDSLIDE_SEGMENTER_PATH`

## 运行方式

### Docker

```bash
docker compose up --build model-service
```

### 本地 Python

```bash
cd model-service
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

## 环境变量

- `MODEL_DEVICE`：`auto`、`cpu`、`cuda`
- `ALLOW_HEURISTIC_FALLBACK`：未加载权重时是否允许降级演示推理；生产环境应保持 `false`
- `LANDSLIDE_CLS_THRESHOLD`：滑坡分类阈值
- `LANDSLIDE_MASK_THRESHOLD`：滑坡分割阈值

## 说明

- 当正式权重存在时，服务会使用 PyTorch 模型推理。
- 当正式权重不存在且 `ALLOW_HEURISTIC_FALLBACK=true` 时，服务会返回降级演示结果，并在响应中附带 `warning`。该模式只适合本地演示和联调。
- 生产环境默认关闭启发式 fallback；缺少权重时应让健康检查降级并阻断正式推理。
- `/health` 在模型缺权重或其他 degraded 状态下返回 HTTP 503，Docker healthcheck 会据此阻断依赖服务启动。
- 主业务后端通过 `AI_INFERENCE_BASE_URL` 对接该服务，无需前端直接访问模型接口。
