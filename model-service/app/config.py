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
    landslide_classifier_path: Path
    landslide_segmenter_path: Path
    glacier_segmenter_path: Path
    landslide_cls_threshold: float
    landslide_mask_threshold: float
    glacier_mask_threshold: float


def _to_bool(value: str | None, default: bool) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def get_settings() -> Settings:
    app_root = Path(__file__).resolve().parent.parent
    models_dir = Path(os.getenv("MODEL_DIR", app_root / "models"))

    return Settings(
        app_root=app_root,
        models_dir=models_dir,
        device=os.getenv("MODEL_DEVICE", "auto"),
        allow_heuristic_fallback=_to_bool(os.getenv("ALLOW_HEURISTIC_FALLBACK"), True),
        landslide_classifier_path=Path(
            os.getenv("LANDSLIDE_CLASSIFIER_PATH", models_dir / "landslide_clf.pth")
        ),
        landslide_segmenter_path=Path(
            os.getenv("LANDSLIDE_SEGMENTER_PATH", models_dir / "landslide_seg.pth")
        ),
        glacier_segmenter_path=Path(
            os.getenv("GLACIER_SEGMENTER_PATH", models_dir / "glacier_insar_unet.pth")
        ),
        landslide_cls_threshold=float(os.getenv("LANDSLIDE_CLS_THRESHOLD", "0.5")),
        landslide_mask_threshold=float(os.getenv("LANDSLIDE_MASK_THRESHOLD", "0.5")),
        glacier_mask_threshold=float(os.getenv("GLACIER_MASK_THRESHOLD", "0.5")),
    )
