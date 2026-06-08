from __future__ import annotations

from contextlib import asynccontextmanager
from functools import lru_cache

from fastapi import FastAPI, File, HTTPException, Response, UploadFile

from app.config import Settings, get_settings
from app.schemas import HealthResponse, LandslidePrediction
from app.services.landslide import LandslideService


@lru_cache
def settings() -> Settings:
    return get_settings()


@lru_cache
def landslide_service() -> LandslideService:
    return LandslideService(settings())


@asynccontextmanager
async def lifespan(_app: FastAPI):
    landslide_service()
    yield


app = FastAPI(
    title="GeoProphet Model Service",
    version="0.1.0",
    description="地质灾害识别模型服务，提供滑坡识别接口。",
    lifespan=lifespan,
)


@app.get("/health", response_model=HealthResponse)
def healthcheck(response: Response) -> HealthResponse:
    landslide = landslide_service()
    warnings = [warning for warning in [landslide.artifacts.warning] if warning]
    health_status = "ok" if landslide.is_ready and not warnings else "degraded"
    if health_status == "degraded":
        response.status_code = 503

    return HealthResponse(
        status=health_status,
        device=str(landslide.device),
        allowHeuristicFallback=settings().allow_heuristic_fallback,
        models={
            "landslideYolo": landslide.artifacts.yolo is not None,
            "landslideClassifier": landslide.artifacts.classifier is not None,
            "landslideSegmenter": landslide.artifacts.segmenter is not None,
        },
        warnings=warnings,
    )


@app.post("/predict/landslide", response_model=LandslidePrediction)
async def predict_landslide(file: UploadFile = File(...)) -> LandslidePrediction:
    try:
        file_bytes = await file.read()
        if not file_bytes:
            raise ValueError("上传文件为空。")
        prediction = landslide_service().predict(file_bytes)
        return LandslidePrediction.model_validate(prediction)
    except Exception as error:
        raise HTTPException(status_code=400, detail=f"滑坡识别失败: {error}") from error
