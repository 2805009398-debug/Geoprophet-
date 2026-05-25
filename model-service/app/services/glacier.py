from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import torch
import segmentation_models_pytorch as smp

from app.config import Settings
from app.utils import deterministic_seed, heuristic_mask, mask_to_polygons, read_insar_array


@dataclass
class GlacierArtifacts:
    segmenter: torch.nn.Module | None
    warning: str | None


class GlacierService:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.device = self._resolve_device(settings.device)
        self.artifacts = self._load_models()

    @property
    def is_ready(self) -> bool:
        return self.artifacts.segmenter is not None

    def predict(self, file_bytes: bytes) -> dict[str, object]:
        insar_array = read_insar_array(file_bytes)

        if self.is_ready:
            return self._predict_with_models(insar_array)

        if not self.settings.allow_heuristic_fallback:
            raise RuntimeError("冰川模型权重未加载，且当前禁用了降级推理。")

        return self._predict_with_fallback(file_bytes)

    def _predict_with_models(self, insar_array: np.ndarray) -> dict[str, object]:
        assert self.artifacts.segmenter is not None

        input_tensor = torch.tensor(insar_array.transpose(2, 0, 1), dtype=torch.float32).unsqueeze(0).to(self.device)
        with torch.inference_mode():
            prediction = self.artifacts.segmenter(input_tensor)
            mask = (prediction.squeeze().detach().cpu().numpy() > self.settings.glacier_mask_threshold).astype("uint8")

        coverage = float(round(mask.mean(), 4))
        confidence = float(round(min(0.98, 0.72 + coverage * 0.5), 4))
        regions = mask_to_polygons(mask, "冰川区域", confidence)

        return {
            "taskType": "glacier",
            "provider": "pytorch",
            "modelName": "GlacierSAR-Net",
            "summary": "已完成 InSAR 冰川主体区域分割，并提取变化敏感区候选范围。",
            "confidence": confidence,
            "glacierMask": mask.tolist(),
            "segmentation": {"regions": regions},
            "metadata": {
                "device": self.device.type,
                "estimatedCoverageRatio": coverage,
                "maskShape": f"{mask.shape[0]}x{mask.shape[1]}",
                "inputChannels": int(insar_array.shape[2]),
            },
            "warning": self.artifacts.warning,
        }

    def _predict_with_fallback(self, file_bytes: bytes) -> dict[str, object]:
        seed = deterministic_seed(file_bytes, "glacier")
        mask = heuristic_mask((256, 256), seed, "glacier")
        confidence = float(round(0.74 + seed * 0.18, 4))
        coverage = float(round(mask.mean(), 4))
        regions = mask_to_polygons(mask, "冰川区域", confidence)

        return {
            "taskType": "glacier",
            "provider": "heuristic-fallback",
            "modelName": "GlacierSAR-Net",
            "summary": "当前未加载正式权重，结果来自降级演示推理，仅用于接口联调。",
            "confidence": confidence,
            "glacierMask": mask.tolist(),
            "segmentation": {"regions": regions},
            "metadata": {
                "device": self.device.type,
                "estimatedCoverageRatio": coverage,
                "inputChannels": 2,
            },
            "warning": self.artifacts.warning or "formal-weights-not-loaded",
        }

    def _load_models(self) -> GlacierArtifacts:
        if not self.settings.glacier_segmenter_path.exists():
            return GlacierArtifacts(
                segmenter=None,
                warning=f"missing-model-files: {self.settings.glacier_segmenter_path.name}",
            )

        segmenter = smp.Unet(encoder_name="resnet34", in_channels=2, classes=1, activation="sigmoid")
        segmenter.load_state_dict(
            torch.load(self.settings.glacier_segmenter_path, map_location=self.device, weights_only=False)
        )
        segmenter = segmenter.to(self.device)
        segmenter.eval()

        return GlacierArtifacts(segmenter=segmenter, warning=None)

    @staticmethod
    def _resolve_device(requested_device: str) -> torch.device:
        if requested_device == "auto":
            return torch.device("cuda" if torch.cuda.is_available() else "cpu")
        if requested_device.startswith("cuda") and not torch.cuda.is_available():
            return torch.device("cpu")
        return torch.device(requested_device)
