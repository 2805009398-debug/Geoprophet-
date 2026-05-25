from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class PolygonPoint(BaseModel):
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)


class SegmentationRegion(BaseModel):
    label: str
    score: float = Field(ge=0, le=1)
    polygon: list[PolygonPoint]


class SegmentationPayload(BaseModel):
    regions: list[SegmentationRegion]


class ClassificationPayload(BaseModel):
    has_hazard: bool = Field(alias="hasHazard")
    label: str
    confidence: float = Field(ge=0, le=1)

    model_config = {"populate_by_name": True}


class PredictionBase(BaseModel):
    task_type: Literal["landslide", "glacier"] = Field(alias="taskType")
    provider: Literal["pytorch", "heuristic-fallback"]
    model_name: str = Field(alias="modelName")
    summary: str
    confidence: float = Field(ge=0, le=1)
    segmentation: SegmentationPayload
    metadata: dict[str, str | float | int | bool | None]
    warning: str | None = None

    model_config = {"populate_by_name": True}


class LandslidePrediction(PredictionBase):
    classification: ClassificationPayload
    has_landslide: bool = Field(alias="hasLandslide")
    mask: list[list[int]]


class GlacierPrediction(PredictionBase):
    glacier_mask: list[list[int]] = Field(alias="glacierMask")


class HealthResponse(BaseModel):
    status: Literal["ok", "degraded"]
    device: str
    allow_heuristic_fallback: bool = Field(alias="allowHeuristicFallback")
    models: dict[str, bool]
    warnings: list[str]

    model_config = {"populate_by_name": True}
