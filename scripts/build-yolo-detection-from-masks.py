from __future__ import annotations

import argparse
import csv
import hashlib
import shutil
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps
from scipy import ndimage


CLASS_ID = 0
CLASS_NAME = "landslide"
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff", ".webp"}
MASK_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff", ".webp"}


@dataclass(frozen=True)
class Pair:
    source: str
    stem: str
    image_path: Path
    mask_path: Path


@dataclass(frozen=True)
class Box:
    x_min: int
    y_min: int
    x_max: int
    y_max: int
    area: int


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Convert an image/binary-mask landslide dataset to YOLO detection format."
    )
    parser.add_argument(
        "--source",
        type=Path,
        default=Path(r"D:\data\015_大规模滑坡数据集滑坡YHT20865"),
        help="Source dataset root containing per-scene images/ and labels/ folders.",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=Path(r"D:\data\yolo_landslide_from_masks"),
        help="Output YOLO dataset directory.",
    )
    parser.add_argument("--train-ratio", type=float, default=0.8)
    parser.add_argument("--val-ratio", type=float, default=0.1)
    parser.add_argument("--test-ratio", type=float, default=0.1)
    parser.add_argument("--min-area", type=int, default=16, help="Drop mask components smaller than this many pixels.")
    parser.add_argument("--min-box-px", type=int, default=2, help="Drop boxes with width/height smaller than this.")
    parser.add_argument("--image-format", choices=["jpg", "png"], default="jpg")
    parser.add_argument("--jpg-quality", type=int, default=95)
    parser.add_argument("--limit", type=int, default=0, help="Optional max pair count for smoke tests.")
    parser.add_argument("--force", action="store_true", help="Remove the output directory before writing.")
    args = parser.parse_args()

    source_root = args.source.resolve()
    out_dir = args.out.resolve()
    validate_args(args, source_root, out_dir)

    pairs = discover_pairs(source_root)
    if args.limit > 0:
        pairs = pairs[: args.limit]
    if not pairs:
        raise SystemExit(f"No image/mask pairs found under {source_root}")

    prepare_output(out_dir, args.force)
    manifest_rows: list[dict[str, object]] = []
    problem_rows: list[dict[str, object]] = []
    split_summary = {
        "train": {"images": 0, "labels": 0, "boxes": 0},
        "val": {"images": 0, "labels": 0, "boxes": 0},
        "test": {"images": 0, "labels": 0, "boxes": 0},
    }
    source_summary: dict[str, dict[str, int]] = {}

    for pair in pairs:
        source_stats = source_summary.setdefault(pair.source, {"images": 0, "labels": 0, "boxes": 0, "problems": 0})
        try:
            split = choose_split(pair, args.train_ratio, args.val_ratio)
            image = load_rgb_image(pair.image_path)
            mask = load_mask(pair.mask_path)
            if image.size != mask.shape[::-1]:
                mask = np.array(Image.fromarray(mask.astype("uint8") * 255).resize(image.size, Image.Resampling.NEAREST)) > 0

            boxes = extract_boxes(mask, args.min_area, args.min_box_px)
            image_rel, label_rel = output_paths(pair, split, args.image_format)
            save_image(image, out_dir / image_rel, args.image_format, args.jpg_quality)
            write_yolo_label(out_dir / label_rel, boxes, image.width, image.height)

            row = {
                "source": pair.source,
                "split": split,
                "image": image_rel.as_posix(),
                "label": label_rel.as_posix(),
                "boxes": len(boxes),
                "original_image": pair.image_path.relative_to(source_root).as_posix(),
                "original_label": pair.mask_path.relative_to(source_root).as_posix(),
            }
            manifest_rows.append(row)

            split_summary[split]["images"] += 1
            split_summary[split]["labels"] += 1
            split_summary[split]["boxes"] += len(boxes)
            source_stats["images"] += 1
            source_stats["labels"] += 1
            source_stats["boxes"] += len(boxes)
        except Exception as exc:
            source_stats["problems"] += 1
            problem_rows.append(
                {
                    "source": pair.source,
                    "item": pair.stem,
                    "problem": f"{type(exc).__name__}: {exc}",
                    "image": str(pair.image_path),
                    "label": str(pair.mask_path),
                }
            )

    write_csv(out_dir / "manifest.csv", manifest_rows)
    write_split_summary(out_dir / "split_summary.csv", split_summary)
    write_source_summary(out_dir / "source_summary.csv", source_summary)
    write_csv(out_dir / "problems.csv", problem_rows)
    write_data_yaml(out_dir)
    write_readme(out_dir, source_root, args, len(pairs), split_summary, problem_rows)
    print_summary(out_dir, len(pairs), split_summary, problem_rows)


def validate_args(args: argparse.Namespace, source_root: Path, out_dir: Path) -> None:
    if not source_root.exists():
        raise SystemExit(f"Source directory does not exist: {source_root}")
    total = args.train_ratio + args.val_ratio + args.test_ratio
    if abs(total - 1.0) > 1e-6:
        raise SystemExit("train-ratio + val-ratio + test-ratio must equal 1.0")
    if args.train_ratio <= 0 or args.val_ratio < 0 or args.test_ratio < 0:
        raise SystemExit("Split ratios must be non-negative and train-ratio must be positive")
    if out_dir == source_root or source_root in out_dir.parents:
        raise SystemExit("Output directory must not be the source directory or inside it")


def discover_pairs(source_root: Path) -> list[Pair]:
    pairs: list[Pair] = []
    for source_dir in sorted([path for path in source_root.iterdir() if path.is_dir()], key=lambda path: path.name.lower()):
        image_dir = source_dir / "images"
        label_dir = source_dir / "labels"
        if not image_dir.exists() or not label_dir.exists():
            continue

        images = files_by_stem(image_dir, IMAGE_EXTENSIONS)
        masks = files_by_stem(label_dir, MASK_EXTENSIONS)
        for stem in sorted(set(images) & set(masks)):
            pairs.append(Pair(source=source_dir.name, stem=stem, image_path=images[stem], mask_path=masks[stem]))
    return pairs


def files_by_stem(directory: Path, extensions: set[str]) -> dict[str, Path]:
    items: dict[str, Path] = {}
    for path in directory.iterdir():
        if path.is_file() and path.suffix.lower() in extensions:
            items.setdefault(path.stem, path)
    return items


def prepare_output(out_dir: Path, force: bool) -> None:
    if out_dir.exists():
        if not force:
            raise SystemExit(f"Output directory already exists, pass --force to replace it: {out_dir}")
        shutil.rmtree(out_dir)
    for split in ("train", "val", "test"):
        (out_dir / "images" / split).mkdir(parents=True, exist_ok=True)
        (out_dir / "labels" / split).mkdir(parents=True, exist_ok=True)


def choose_split(pair: Pair, train_ratio: float, val_ratio: float) -> str:
    digest = hashlib.sha1(f"{pair.source}/{pair.stem}".encode("utf-8")).hexdigest()
    bucket = int(digest[:8], 16) / 0xFFFFFFFF
    if bucket < train_ratio:
        return "train"
    if bucket < train_ratio + val_ratio:
        return "val"
    return "test"


def load_rgb_image(path: Path) -> Image.Image:
    with Image.open(path) as image:
        return ImageOps.exif_transpose(image).convert("RGB")


def load_mask(path: Path) -> np.ndarray:
    with Image.open(path) as image:
        arr = np.array(image.convert("L"))
    return arr > 0


def extract_boxes(mask: np.ndarray, min_area: int, min_box_px: int) -> list[Box]:
    if not mask.any():
        return []

    structure = np.ones((3, 3), dtype=np.uint8)
    labeled, count = ndimage.label(mask, structure=structure)
    slices = ndimage.find_objects(labeled)
    boxes: list[Box] = []

    for index, component_slice in enumerate(slices, start=1):
        if component_slice is None:
            continue
        y_slice, x_slice = component_slice
        area = int(np.count_nonzero(labeled[component_slice] == index))
        x_min = int(x_slice.start)
        y_min = int(y_slice.start)
        x_max = int(x_slice.stop)
        y_max = int(y_slice.stop)
        if area < min_area or x_max - x_min < min_box_px or y_max - y_min < min_box_px:
            continue
        boxes.append(Box(x_min=x_min, y_min=y_min, x_max=x_max, y_max=y_max, area=area))

    return boxes


def output_paths(pair: Pair, split: str, image_format: str) -> tuple[Path, Path]:
    safe_source = sanitize_name(pair.source)
    safe_stem = sanitize_name(pair.stem)
    digest = hashlib.sha1(f"{pair.source}/{pair.stem}".encode("utf-8")).hexdigest()[:10]
    base_name = f"{safe_source}_{safe_stem}_{digest}"
    return Path("images") / split / f"{base_name}.{image_format}", Path("labels") / split / f"{base_name}.txt"


def sanitize_name(value: str) -> str:
    chars = []
    for char in value:
        if char.isascii() and char.isalnum():
            chars.append(char)
        else:
            chars.append("_")
    sanitized = "_".join("".join(chars).split("_"))
    return sanitized or "item"


def save_image(image: Image.Image, path: Path, image_format: str, jpg_quality: int) -> None:
    if image_format == "jpg":
        image.save(path, format="JPEG", quality=jpg_quality, optimize=True)
    else:
        image.save(path, format="PNG", optimize=True)


def write_yolo_label(path: Path, boxes: list[Box], image_width: int, image_height: int) -> None:
    lines = []
    for box in boxes:
        x_center = ((box.x_min + box.x_max) / 2) / image_width
        y_center = ((box.y_min + box.y_max) / 2) / image_height
        width = (box.x_max - box.x_min) / image_width
        height = (box.y_max - box.y_min) / image_height
        lines.append(f"{CLASS_ID} {x_center:.6f} {y_center:.6f} {width:.6f} {height:.6f}\n")
    path.write_text("".join(lines), encoding="utf-8")


def write_data_yaml(out_dir: Path) -> None:
    text = "\n".join(
        [
            f"path: {out_dir.as_posix()}",
            "train: images/train",
            "val: images/val",
            "test: images/test",
            "names:",
            f"  {CLASS_ID}: {CLASS_NAME}",
            "",
        ]
    )
    (out_dir / "data.yaml").write_text(text, encoding="utf-8")


def write_split_summary(path: Path, split_summary: dict[str, dict[str, int]]) -> None:
    rows = [
        {"split": split, **values}
        for split, values in split_summary.items()
    ]
    write_csv(path, rows)


def write_source_summary(path: Path, source_summary: dict[str, dict[str, int]]) -> None:
    rows = [
        {"source": source, **values}
        for source, values in sorted(source_summary.items())
    ]
    write_csv(path, rows)


def write_csv(path: Path, rows: list[dict[str, object]]) -> None:
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def write_readme(
    out_dir: Path,
    source_root: Path,
    args: argparse.Namespace,
    pair_count: int,
    split_summary: dict[str, dict[str, int]],
    problem_rows: list[dict[str, object]],
) -> None:
    text = f"""# Landslide YOLO Detection Dataset

Generated from paired RGB/GeoTIFF images and binary landslide masks.

- source: `{source_root}`
- class `0`: `{CLASS_NAME}`
- source pairs scanned: {pair_count}
- conversion: connected mask components to YOLO bounding boxes
- min_area: {args.min_area}
- min_box_px: {args.min_box_px}
- image_format: {args.image_format}
- problems: {len(problem_rows)}

## Splits

| split | images | labels | boxes |
| --- | ---: | ---: | ---: |
| train | {split_summary["train"]["images"]} | {split_summary["train"]["labels"]} | {split_summary["train"]["boxes"]} |
| val | {split_summary["val"]["images"]} | {split_summary["val"]["labels"]} | {split_summary["val"]["boxes"]} |
| test | {split_summary["test"]["images"]} | {split_summary["test"]["labels"]} | {split_summary["test"]["boxes"]} |

YOLO labels use `class_id x_center_norm y_center_norm width_norm height_norm`.
"""
    (out_dir / "README.md").write_text(text, encoding="utf-8")


def print_summary(
    out_dir: Path,
    pair_count: int,
    split_summary: dict[str, dict[str, int]],
    problem_rows: list[dict[str, object]],
) -> None:
    print(f"Output: {out_dir}")
    print(f"Pairs scanned: {pair_count}")
    for split in ("train", "val", "test"):
        stats = split_summary[split]
        print(f"{split}: images={stats['images']} labels={stats['labels']} boxes={stats['boxes']}")
    print(f"Problems: {len(problem_rows)}")
    print(f"Data YAML: {out_dir / 'data.yaml'}")


if __name__ == "__main__":
    main()
