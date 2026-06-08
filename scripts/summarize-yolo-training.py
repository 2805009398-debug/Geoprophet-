from __future__ import annotations

import csv
from pathlib import Path


RUN_DIR = Path(r"D:\hicool\models\yolo_landslide_from_masks\yolov8n_640")
RESULTS_CSV = RUN_DIR / "results.csv"
WEIGHTS_DIR = RUN_DIR / "weights"


def load_rows() -> list[dict[str, str]]:
    if not RESULTS_CSV.exists():
        return []
    with RESULTS_CSV.open("r", encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def main() -> None:
    rows = load_rows()
    print(f"run_dir={RUN_DIR}")
    print(f"results_exists={RESULTS_CSV.exists()}")
    print(f"best_exists={(WEIGHTS_DIR / 'best.pt').exists()}")
    print(f"last_exists={(WEIGHTS_DIR / 'last.pt').exists()}")

    if not rows:
        print("status=no_results_yet")
        return

    latest = rows[-1]
    best = max(rows, key=lambda row: float(row["metrics/mAP50-95(B)"]))

    print(f"epochs_recorded={len(rows)}")
    print(f"latest_epoch={latest['epoch']}")
    print(f"latest_precision={float(latest['metrics/precision(B)']):.5f}")
    print(f"latest_recall={float(latest['metrics/recall(B)']):.5f}")
    print(f"latest_mAP50={float(latest['metrics/mAP50(B)']):.5f}")
    print(f"latest_mAP50_95={float(latest['metrics/mAP50-95(B)']):.5f}")
    print(f"best_epoch={best['epoch']}")
    print(f"best_precision={float(best['metrics/precision(B)']):.5f}")
    print(f"best_recall={float(best['metrics/recall(B)']):.5f}")
    print(f"best_mAP50={float(best['metrics/mAP50(B)']):.5f}")
    print(f"best_mAP50_95={float(best['metrics/mAP50-95(B)']):.5f}")


if __name__ == "__main__":
    main()
