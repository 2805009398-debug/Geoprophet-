from __future__ import annotations

import hashlib
from io import BytesIO
from typing import Literal

import numpy as np
from PIL import Image


def read_rgb_image(file_bytes: bytes) -> Image.Image:
    return Image.open(BytesIO(file_bytes)).convert("RGB")


def read_insar_array(file_bytes: bytes) -> np.ndarray:
    image = Image.open(BytesIO(file_bytes))
    array = np.array(image)

    if array.ndim == 2:
        array = np.stack([array, array], axis=-1)
    elif array.ndim == 3 and array.shape[2] == 1:
        array = np.repeat(array, 2, axis=2)
    elif array.ndim == 3 and array.shape[2] >= 2:
        array = array[:, :, :2]
    else:
        raise ValueError("无法解析 InSAR 影像通道结构。")

    array = array.astype("float32")
    return normalize_per_channel(array)


def normalize_per_channel(array: np.ndarray) -> np.ndarray:
    normalized = np.zeros_like(array, dtype="float32")

    for channel_idx in range(array.shape[2]):
        channel = array[:, :, channel_idx]
        low = np.percentile(channel, 2)
        high = np.percentile(channel, 98)
        if high <= low:
            normalized[:, :, channel_idx] = 0
            continue
        clipped = np.clip(channel, low, high)
        normalized[:, :, channel_idx] = (clipped - low) / (high - low)

    return normalized


def mask_to_polygons(mask: np.ndarray, label: str, score: float) -> list[dict[str, object]]:
    binary = mask.astype(bool)
    if not binary.any():
        return []

    rows, cols = np.where(binary)
    min_row = rows.min()
    max_row = rows.max()
    min_col = cols.min()
    max_col = cols.max()
    height, width = mask.shape

    polygon = [
        {"x": float(min_col / width), "y": float(min_row / height)},
        {"x": float((max_col + 1) / width), "y": float(min_row / height)},
        {"x": float((max_col + 1) / width), "y": float((max_row + 1) / height)},
        {"x": float(min_col / width), "y": float((max_row + 1) / height)},
    ]

    return [{"label": label, "score": float(score), "polygon": polygon}]


def deterministic_seed(file_bytes: bytes, suffix: str) -> float:
    digest = hashlib.sha1(file_bytes + suffix.encode("utf-8")).digest()
    return int.from_bytes(digest[:4], "big") / 0xFFFFFFFF


def heuristic_mask(shape: tuple[int, int], seed: float, variant: Literal["landslide", "glacier"]) -> np.ndarray:
    height, width = shape
    center_x = int((0.3 + seed * 0.4) * width)
    center_y = int((0.28 + ((seed * 1.7) % 1) * 0.4) * height)
    radius_x = int((0.1 + ((seed * 2.1) % 1) * 0.14) * width)
    radius_y = int((0.09 + ((seed * 2.9) % 1) * 0.12) * height)

    yy, xx = np.ogrid[:height, :width]
    ellipse = (((xx - center_x) / max(radius_x, 1)) ** 2 + ((yy - center_y) / max(radius_y, 1)) ** 2) <= 1.0

    if variant == "glacier":
        offset = int(radius_x * 0.45)
        ellipse |= (
            (((xx - (center_x + offset)) / max(int(radius_x * 0.7), 1)) ** 2)
            + (((yy - (center_y - int(radius_y * 0.25))) / max(int(radius_y * 0.82), 1)) ** 2)
        ) <= 1.0

    return ellipse.astype("uint8")
