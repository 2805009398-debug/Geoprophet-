from pathlib import Path

from ultralytics import YOLO


DATASET_YAML = Path(r"D:\data\yolo_landslide_from_masks\data.yaml")
PROJECT_DIR = Path(r"D:\hicool\models\yolo_landslide_from_masks")


def main() -> None:
    model = YOLO("yolov8n.pt")
    model.train(
        data=str(DATASET_YAML),
        imgsz=640,
        epochs=100,
        batch=16,
        workers=0,
        device=0,
        pretrained=True,
        cache=False,
        amp=True,
        cos_lr=True,
        patience=20,
        optimizer="auto",
        project=str(PROJECT_DIR),
        name="yolov8n_640",
        exist_ok=True,
    )


if __name__ == "__main__":
    main()
