from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import torch
from PIL import Image
from torchvision import models, transforms
import segmentation_models_pytorch as smp

from app.config import Settings
from app.utils import deterministic_seed, heuristic_mask, mask_to_polygons, read_rgb_image


@dataclass
class LandslideArtifacts:
    # 分类器和分割器都允许为空，这样服务在缺少权重时仍可按配置降级运行。
    classifier: torch.nn.Module | None
    segmenter: torch.nn.Module | None
    warning: str | None


class LandslideService:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.device = self._resolve_device(settings.device)
        # 分类阶段沿用常见的 ImageNet 预处理，与 ResNet18 微调时保持一致。
        self.preprocess = transforms.Compose(
            [
                transforms.Resize((224, 224)),
                transforms.ToTensor(),
                transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
            ]
        )
        # 分割阶段使用单独尺寸，便于和训练 UNet 时的输入约定保持一致。
        self.segment_preprocess = transforms.Compose(
            [
                transforms.Resize((256, 256)),
                transforms.ToTensor(),
            ]
        )
        self.artifacts = self._load_models()

    @property
    def is_ready(self) -> bool:
        return self.artifacts.classifier is not None and self.artifacts.segmenter is not None

    def predict(self, file_bytes: bytes) -> dict[str, object]:
        image = read_rgb_image(file_bytes)

        # 正式权重就绪时走真实 PyTorch 推理，否则按配置决定是否进入降级逻辑。
        if self.is_ready:
            return self._predict_with_models(image)

        if not self.settings.allow_heuristic_fallback:
            raise RuntimeError("滑坡模型权重未加载，且当前禁用了降级推理。")

        return self._predict_with_fallback(file_bytes)

    def _predict_with_models(self, image: Image.Image) -> dict[str, object]:
        assert self.artifacts.classifier is not None
        assert self.artifacts.segmenter is not None

        # 第一步先做有/无滑坡分类，避免对明显正常样本执行更重的分割推理。
        input_tensor = self.preprocess(image).unsqueeze(0).to(self.device)
        with torch.inference_mode():
            logits = self.artifacts.classifier(input_tensor)
            probs = torch.softmax(logits, dim=1).squeeze(0)
            confidence = float(probs[1].item())
            has_landslide = confidence >= self.settings.landslide_cls_threshold

        if not has_landslide:
            empty_mask = np.zeros((256, 256), dtype="uint8")
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

        # 只有分类通过阈值时，才继续执行区域分割。
        segment_input = self.segment_preprocess(image).unsqueeze(0).to(self.device)
        with torch.inference_mode():
            mask_logits = self.artifacts.segmenter(segment_input)
            # Sigmoid 输出是像素概率图，这里按阈值转成 0/1 mask。
            mask = (mask_logits.squeeze().detach().cpu().numpy() > self.settings.landslide_mask_threshold).astype(
                "uint8"
            )

        # 当前主后端更适合消费简单 polygon，因此这里把 mask 再提炼成外接区域。
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
                "maskShape": "256x256",
            },
            "warning": self.artifacts.warning,
        }

    def _predict_with_fallback(self, file_bytes: bytes) -> dict[str, object]:
        # 降级模式只用于接口联调：基于文件内容生成稳定伪结果，保证同文件多次请求一致。
        seed = deterministic_seed(file_bytes, "landslide")
        has_landslide = seed >= 0.38
        confidence = float(round((0.68 + seed * 0.25) if has_landslide else (0.61 + (0.38 - seed) * 0.4), 4))
        mask = heuristic_mask((256, 256), seed, "landslide") if has_landslide else np.zeros((256, 256), dtype="uint8")
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
        missing = []
        if not self.settings.landslide_classifier_path.exists():
            missing.append(str(self.settings.landslide_classifier_path.name))
        if not self.settings.landslide_segmenter_path.exists():
            missing.append(str(self.settings.landslide_segmenter_path.name))

        if missing:
            return LandslideArtifacts(
                classifier=None,
                segmenter=None,
                warning=f"missing-model-files: {', '.join(missing)}",
            )

        # 分类模型：ResNet18 二分类，输出 [无滑坡, 有滑坡] 两类。
        classifier = models.resnet18()
        classifier.fc = torch.nn.Linear(classifier.fc.in_features, 2)
        classifier.load_state_dict(
            torch.load(self.settings.landslide_classifier_path, map_location=self.device, weights_only=False)
        )
        classifier = classifier.to(self.device)
        classifier.eval()

        # 分割模型：UNet 输出单通道滑坡概率图。
        segmenter = smp.Unet(encoder_name="resnet34", classes=1, activation="sigmoid")
        segmenter.load_state_dict(
            torch.load(self.settings.landslide_segmenter_path, map_location=self.device, weights_only=False)
        )
        segmenter = segmenter.to(self.device)
        segmenter.eval()

        return LandslideArtifacts(classifier=classifier, segmenter=segmenter, warning=None)

    @staticmethod
    def _resolve_device(requested_device: str) -> torch.device:
        # auto 会优先使用 CUDA；如果显式请求了 CUDA 但机器不支持，则自动回退到 CPU。
        if requested_device == "auto":
            return torch.device("cuda" if torch.cuda.is_available() else "cpu")
        if requested_device.startswith("cuda") and not torch.cuda.is_available():
            return torch.device("cpu")
        return torch.device(requested_device)
