from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    app_root: Path
    models_dir: Path
    device: str
    allow_heuristic_fallback: bool
    landslide_yolo_path: Path
    landslide_yolo_conf: float
    landslide_yolo_review_conf: float
    landslide_yolo_review_min_area: float
    landslide_yolo_iou: float
    landslide_yolo_imgsz: int
    landslide_yolo_max_det: int
    landslide_classifier_path: Path
    landslide_segmenter_path: Path
    landslide_cls_threshold: float
    landslide_mask_threshold: float


def _to_bool(value: str | None, default: bool) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def get_settings() -> Settings:
    app_root = Path(__file__).resolve().parent.parent
    models_dir = Path(os.getenv("MODEL_DIR", app_root / "models"))
    default_yolo_path = app_root.parent / "models" / "yolo_landslide_from_masks" / "yolov8n_640" / "weights" / "best.pt"

    return Settings(
        app_root=app_root,
        models_dir=models_dir,
        device=os.getenv("MODEL_DEVICE", "auto"),
        allow_heuristic_fallback=_to_bool(os.getenv("ALLOW_HEURISTIC_FALLBACK"), False),
        landslide_yolo_path=Path(os.getenv("LANDSLIDE_YOLO_PATH", default_yolo_path)),
        landslide_yolo_conf=float(os.getenv("LANDSLIDE_YOLO_CONF", "0.25")),
        landslide_yolo_review_conf=float(os.getenv("LANDSLIDE_YOLO_REVIEW_CONF", "0.05")),
        landslide_yolo_review_min_area=float(os.getenv("LANDSLIDE_YOLO_REVIEW_MIN_AREA", "0.08")),
        landslide_yolo_iou=float(os.getenv("LANDSLIDE_YOLO_IOU", "0.45")),
        landslide_yolo_imgsz=int(os.getenv("LANDSLIDE_YOLO_IMGSZ", "640")),
        landslide_yolo_max_det=int(os.getenv("LANDSLIDE_YOLO_MAX_DET", "300")),
        landslide_classifier_path=Path(
            os.getenv("LANDSLIDE_CLASSIFIER_PATH", models_dir / "landslide_clf.pth")
        ),
        landslide_segmenter_path=Path(
            os.getenv("LANDSLIDE_SEGMENTER_PATH", models_dir / "landslide_seg.pth")
        ),
        landslide_cls_threshold=float(os.getenv("LANDSLIDE_CLS_THRESHOLD", "0.5")),
        landslide_mask_threshold=float(os.getenv("LANDSLIDE_MASK_THRESHOLD", "0.5")),
    )
