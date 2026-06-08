from pathlib import Path

from ultralytics import YOLO


LAST_CHECKPOINT = Path(
    r"D:\hicool\models\yolo_landslide_from_masks\yolov8n_640\weights\last.pt"
)


def main() -> None:
    if not LAST_CHECKPOINT.exists():
        raise FileNotFoundError(f"Missing checkpoint: {LAST_CHECKPOINT}")

    model = YOLO(str(LAST_CHECKPOINT))
    model.train(resume=True)


if __name__ == "__main__":
    main()
