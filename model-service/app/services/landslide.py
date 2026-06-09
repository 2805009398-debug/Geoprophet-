from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
import torch
from PIL import Image
from torchvision import transforms

from app.config import Settings
from app.utils import deterministic_seed, heuristic_mask, mask_to_polygons, read_rgb_image

try:
    from ultralytics import YOLO
except Exception:  # pragma: no cover - 依赖缺失时允许服务降级
    YOLO = None


MASK_SIZE = 256


@dataclass
class LandslideArtifacts:
    # 训练好的 YOLO 检测器优先使用，老的分类/分割模型保留为兼容回退方案。
    yolo: Any | None
    classifier: torch.nn.Module | None
    segmenter: torch.nn.Module | None
    warning: str | None


class LandslideService:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.device = self._resolve_device(settings.device)
        self.preprocess = transforms.Compose(
            [
                transforms.Resize((224, 224)),
                transforms.ToTensor(),
                transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
            ]
        )
        self.segment_preprocess = transforms.Compose(
            [
                transforms.Resize((MASK_SIZE, MASK_SIZE)),
                transforms.ToTensor(),
            ]
        )
        self.artifacts = self._load_models()

    @property
    def is_ready(self) -> bool:
        return self.artifacts.yolo is not None or (
            self.artifacts.classifier is not None and self.artifacts.segmenter is not None
        )

    def predict(self, file_bytes: bytes) -> dict[str, object]:
        image = read_rgb_image(file_bytes)

        if self.artifacts.yolo is not None:
            return self._predict_with_yolo(image)

        if self.artifacts.classifier is not None and self.artifacts.segmenter is not None:
            return self._predict_with_legacy_models(image)

        if not self.settings.allow_heuristic_fallback:
            raise RuntimeError("滑坡模型权重未加载，且当前禁用了降级推理。")

        return self._predict_with_fallback(file_bytes)

    def _predict_with_yolo(self, image: Image.Image) -> dict[str, object]:
        assert self.artifacts.yolo is not None

        results = self._run_yolo_prediction(image, self.settings.landslide_yolo_conf)
        result = results[0]
        image_width, image_height = image.size
        boxes, scores = self._extract_yolo_boxes(result)

        review_mode = False
        if not len(boxes) and self.settings.landslide_yolo_review_conf < self.settings.landslide_yolo_conf:
            review_results = self._run_yolo_prediction(image, self.settings.landslide_yolo_review_conf)
            review_boxes, review_scores = self._extract_yolo_boxes(review_results[0])
            review_boxes, review_scores = self._filter_large_review_boxes(
                review_boxes,
                review_scores,
                image_width,
                image_height,
            )
            if len(review_boxes):
                boxes = review_boxes
                scores = review_scores
                review_mode = True

        regions = self._boxes_to_regions(boxes, scores, image_width, image_height)
        has_landslide = len(regions) > 0
        mask = self._boxes_to_mask(boxes, image_width, image_height)
        top_confidence = float(scores.max()) if len(scores) else 0.0
        confidence = float(round(top_confidence if has_landslide else (1 - self.settings.landslide_yolo_conf), 4))

        if has_landslide:
            summary = f"检测到 {len(regions)} 处疑似滑坡区域，建议结合现场踏勘进一步复核。"
            if review_mode:
                summary = f"低阈值复核检测到 {len(regions)} 处大面积疑似滑坡区域，建议优先人工复核。"
        else:
            summary = "未检出明显滑坡目标，可作为巡查背景样本留存。"

        return {
            "taskType": "landslide",
            "provider": "ultralytics-yolo",
            "modelName": "YOLOv8n-Landslide",
            "summary": summary,
            "confidence": confidence,
            "classification": {
                "hasHazard": has_landslide,
                "label": "landslide" if has_landslide else "no-landslide",
                "confidence": confidence,
            },
            "hasLandslide": has_landslide,
            "mask": mask.tolist(),
            "segmentation": {"regions": regions},
            "metadata": {
                "device": self.device.type,
                "inputMode": "ground-or-uav-photo",
                "segmentationTriggered": has_landslide,
                "maskShape": f"{MASK_SIZE}x{MASK_SIZE}",
                "detectionCount": len(regions),
                "detectionThreshold": self.settings.landslide_yolo_conf,
                "reviewDetectionTriggered": review_mode,
                "reviewDetectionThreshold": self.settings.landslide_yolo_review_conf,
                "reviewMinArea": self.settings.landslide_yolo_review_min_area,
                "iouThreshold": self.settings.landslide_yolo_iou,
                "imageWidth": image_width,
                "imageHeight": image_height,
            },
            "warning": self.artifacts.warning,
        }

    def _run_yolo_prediction(self, image: Image.Image, conf: float) -> Any:
        assert self.artifacts.yolo is not None

        return self.artifacts.yolo.predict(
            source=image,
            imgsz=self.settings.landslide_yolo_imgsz,
            conf=conf,
            iou=self.settings.landslide_yolo_iou,
            max_det=self.settings.landslide_yolo_max_det,
            device=self._yolo_device_argument(),
            verbose=False,
        )

    @staticmethod
    def _extract_yolo_boxes(result: Any) -> tuple[np.ndarray, np.ndarray]:
        boxes = np.empty((0, 4), dtype="float32")
        scores = np.empty((0,), dtype="float32")
        if result.boxes is not None and len(result.boxes) > 0:
            boxes = result.boxes.xyxy.detach().cpu().numpy().astype("float32")
            scores = result.boxes.conf.detach().cpu().numpy().astype("float32")
        return boxes, scores

    def _filter_large_review_boxes(
        self,
        boxes: np.ndarray,
        scores: np.ndarray,
        image_width: int,
        image_height: int,
    ) -> tuple[np.ndarray, np.ndarray]:
        if not len(boxes):
            return boxes, scores

        image_area = max(image_width * image_height, 1)
        keep_indices: list[int] = []
        for index, box in enumerate(boxes):
            x_min, y_min, x_max, y_max = [float(value) for value in box]
            box_area = max(0.0, x_max - x_min) * max(0.0, y_max - y_min)
            if box_area / image_area >= self.settings.landslide_yolo_review_min_area:
                keep_indices.append(index)

        if not keep_indices:
            return np.empty((0, 4), dtype="float32"), np.empty((0,), dtype="float32")

        return boxes[keep_indices], scores[keep_indices]

    def _predict_with_legacy_models(self, image: Image.Image) -> dict[str, object]:
        assert self.artifacts.classifier is not None
        assert self.artifacts.segmenter is not None

        input_tensor = self.preprocess(image).unsqueeze(0).to(self.device)
        with torch.inference_mode():
            logits = self.artifacts.classifier(input_tensor)
            probs = torch.softmax(logits, dim=1).squeeze(0)
            confidence = float(probs[1].item())
            has_landslide = confidence >= self.settings.landslide_cls_threshold

        if not has_landslide:
            empty_mask = np.zeros((MASK_SIZE, MASK_SIZE), dtype="uint8")
            return {
                "taskType": "landslide",
                "provider": "pytorch",
                "modelName": "LandslideVision",
                "summary": "分类模型未检出明显滑坡迹象，本次未触发区域分割。",
                "confidence": float(round(max(confidence, 1 - confidence), 4)),
                "classification": {
                    "hasHazard": False,
                    "label": "no-landslide",
                    "confidence": float(round(1 - confidence, 4)),
                },
                "hasLandslide": False,
                "mask": empty_mask.tolist(),
                "segmentation": {"regions": []},
                "metadata": {
                    "device": self.device.type,
                    "segmentationTriggered": False,
                },
                "warning": self.artifacts.warning,
            }

        segment_input = self.segment_preprocess(image).unsqueeze(0).to(self.device)
        with torch.inference_mode():
            mask_logits = self.artifacts.segmenter(segment_input)
            mask = (mask_logits.squeeze().detach().cpu().numpy() > self.settings.landslide_mask_threshold).astype(
                "uint8"
            )

        regions = mask_to_polygons(mask, "疑似滑坡区域", confidence)
        return {
            "taskType": "landslide",
            "provider": "pytorch",
            "modelName": "LandslideVision",
            "summary": "检测到疑似滑坡区域，建议结合现场踏勘和时序数据进一步复核。",
            "confidence": float(round(confidence, 4)),
            "classification": {
                "hasHazard": True,
                "label": "landslide",
                "confidence": float(round(confidence, 4)),
            },
            "hasLandslide": True,
            "mask": mask.tolist(),
            "segmentation": {"regions": regions},
            "metadata": {
                "device": self.device.type,
                "segmentationTriggered": True,
                "maskShape": f"{MASK_SIZE}x{MASK_SIZE}",
            },
            "warning": self.artifacts.warning,
        }

    def _predict_with_fallback(self, file_bytes: bytes) -> dict[str, object]:
        seed = deterministic_seed(file_bytes, "landslide")
        has_landslide = seed >= 0.38
        confidence = float(round((0.68 + seed * 0.25) if has_landslide else (0.61 + (0.38 - seed) * 0.4), 4))
        mask = heuristic_mask((MASK_SIZE, MASK_SIZE), seed, "landslide") if has_landslide else np.zeros(
            (MASK_SIZE, MASK_SIZE), dtype="uint8"
        )
        regions = mask_to_polygons(mask, "疑似滑坡区域", confidence)

        return {
            "taskType": "landslide",
            "provider": "heuristic-fallback",
            "modelName": "LandslideVision",
            "summary": "当前未加载正式权重，结果来自降级演示推理，仅用于接口联调。",
            "confidence": confidence,
            "classification": {
                "hasHazard": has_landslide,
                "label": "landslide" if has_landslide else "no-landslide",
                "confidence": confidence,
            },
            "hasLandslide": has_landslide,
            "mask": mask.tolist(),
            "segmentation": {"regions": regions},
            "metadata": {
                "device": self.device.type,
                "segmentationTriggered": has_landslide,
            },
            "warning": self.artifacts.warning or "formal-weights-not-loaded",
        }

    def _load_models(self) -> LandslideArtifacts:
        yolo_model = self._load_yolo_model()
        if yolo_model is not None:
            return LandslideArtifacts(yolo=yolo_model, classifier=None, segmenter=None, warning=None)

        legacy = self._load_legacy_models()
        if legacy is not None:
            return legacy

        warning_messages: list[str] = []
        if not self.settings.landslide_yolo_path.exists():
            warning_messages.append(f"missing-model-file: {self.settings.landslide_yolo_path.name}")
        elif YOLO is None:
            warning_messages.append("missing-dependency: ultralytics")
        else:
            warning_messages.append(f"failed-to-load: {self.settings.landslide_yolo_path.name}")

        if not self.settings.landslide_classifier_path.exists():
            warning_messages.append(f"missing-model-file: {self.settings.landslide_classifier_path.name}")
        if not self.settings.landslide_segmenter_path.exists():
            warning_messages.append(f"missing-model-file: {self.settings.landslide_segmenter_path.name}")

        warning = "; ".join(warning_messages) if warning_messages else "no-models-loaded"
        return LandslideArtifacts(yolo=None, classifier=None, segmenter=None, warning=warning)

    def _load_yolo_model(self) -> Any | None:
        if YOLO is None or not self.settings.landslide_yolo_path.exists():
            return None

        model = YOLO(str(self.settings.landslide_yolo_path))
        return model

    def _load_legacy_models(self) -> LandslideArtifacts | None:
        if not (
            self.settings.landslide_classifier_path.exists() and self.settings.landslide_segmenter_path.exists()
        ):
            return None

        from torchvision import models
        import segmentation_models_pytorch as smp

        classifier = models.resnet18()
        classifier.fc = torch.nn.Linear(classifier.fc.in_features, 2)
        classifier.load_state_dict(
            torch.load(self.settings.landslide_classifier_path, map_location=self.device, weights_only=False)
        )
        classifier = classifier.to(self.device)
        classifier.eval()

        segmenter = smp.Unet(encoder_name="resnet34", classes=1, activation="sigmoid")
        segmenter.load_state_dict(
            torch.load(self.settings.landslide_segmenter_path, map_location=self.device, weights_only=False)
        )
        segmenter = segmenter.to(self.device)
        segmenter.eval()
        return LandslideArtifacts(yolo=None, classifier=classifier, segmenter=segmenter, warning=None)

    @staticmethod
    def _resolve_device(requested_device: str) -> torch.device:
        if requested_device == "auto":
            return torch.device("cuda" if torch.cuda.is_available() else "cpu")
        if requested_device.startswith("cuda") and not torch.cuda.is_available():
            return torch.device("cpu")
        return torch.device(requested_device)

    def _yolo_device_argument(self) -> str | int:
        if self.device.type != "cuda":
            return "cpu"
        if self.device.index in (None, 0):
            return 0
        return str(self.device)

    @staticmethod
    def _boxes_to_regions(
        boxes: np.ndarray, scores: np.ndarray, image_width: int, image_height: int
    ) -> list[dict[str, object]]:
        regions: list[dict[str, object]] = []
        for index, (box, score) in enumerate(zip(boxes, scores), start=1):
            x_min, y_min, x_max, y_max = [float(value) for value in box]
            polygon = [
                {"x": max(0.0, min(1.0, x_min / image_width)), "y": max(0.0, min(1.0, y_min / image_height))},
                {"x": max(0.0, min(1.0, x_max / image_width)), "y": max(0.0, min(1.0, y_min / image_height))},
                {"x": max(0.0, min(1.0, x_max / image_width)), "y": max(0.0, min(1.0, y_max / image_height))},
                {"x": max(0.0, min(1.0, x_min / image_width)), "y": max(0.0, min(1.0, y_max / image_height))},
            ]
            regions.append(
                {
                    "label": f"疑似滑坡区域 {index}",
                    "score": float(round(float(score), 4)),
                    "polygon": polygon,
                }
            )
        return regions

    @staticmethod
    def _boxes_to_mask(boxes: np.ndarray, image_width: int, image_height: int) -> np.ndarray:
        mask = np.zeros((MASK_SIZE, MASK_SIZE), dtype="uint8")
        if not len(boxes):
            return mask

        scale_x = MASK_SIZE / max(image_width, 1)
        scale_y = MASK_SIZE / max(image_height, 1)
        for box in boxes:
            x_min, y_min, x_max, y_max = [float(value) for value in box]
            left = max(0, min(MASK_SIZE - 1, int(np.floor(x_min * scale_x))))
            top = max(0, min(MASK_SIZE - 1, int(np.floor(y_min * scale_y))))
            right = max(left + 1, min(MASK_SIZE, int(np.ceil(x_max * scale_x))))
            bottom = max(top + 1, min(MASK_SIZE, int(np.ceil(y_max * scale_y))))
            mask[top:bottom, left:right] = 1
        return mask
