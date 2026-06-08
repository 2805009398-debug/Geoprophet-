from __future__ import annotations

import argparse
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd


DEFAULT_SOURCE = Path(r"C:\Users\暗影\Desktop\samples_climate_summer_allshp_with_SW.csv")
DEFAULT_OUTPUT_PNG = Path(r"C:\Users\暗影\Desktop\SW_LST_panel_c_from_csv.png")
DEFAULT_OUTPUT_TIF = Path(r"C:\Users\暗影\Desktop\SW_LST_panel_c_from_csv.tif")
SW_COLUMN_CANDIDATES = (
    "summer_swdown_mean_Wm2",
    "summer_day_swdown_mean_Wm2",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate mechanism panel c for delta SW forcing vs delta LST."
    )
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output-png", type=Path, default=DEFAULT_OUTPUT_PNG)
    parser.add_argument("--output-tif", type=Path, default=DEFAULT_OUTPUT_TIF)
    parser.add_argument(
        "--display-quantile",
        type=float,
        default=0.05,
        help="Trim the plotted x-range to [q, 1-q] for readability.",
    )
    parser.add_argument(
        "--bootstrap",
        type=int,
        default=250,
        help="Number of bootstrap resamples for the confidence band.",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=42,
        help="Random seed for bootstrap resampling.",
    )
    return parser.parse_args()


def gaussian_kernel_regression(
    x: np.ndarray,
    y: np.ndarray,
    grid: np.ndarray,
    bandwidth: float,
) -> np.ndarray:
    diff = (grid[:, None] - x[None, :]) / bandwidth
    weights = np.exp(-0.5 * diff * diff)
    weights_sum = weights.sum(axis=1)
    return (weights @ y) / weights_sum


def build_dataframe(source: Path) -> pd.DataFrame:
    if source.suffix.lower() == ".csv":
        raw = pd.read_csv(source)
    else:
        raw = pd.read_excel(source)

    sw_column = next((name for name in SW_COLUMN_CANDIDATES if name in raw.columns), None)
    if sw_column is None:
        expected = ", ".join(SW_COLUMN_CANDIDATES)
        raise ValueError(f"No SWdown column found. Expected one of: {expected}")

    df = raw[["dLST_adj", "d_albedo", sw_column]].dropna()

    # In the audit table, d_albedo = albedo_pf - albedo_nf.
    # Keep delta SW in the same contrast direction as dLST_adj.
    df["delta_SWabs"] = df[sw_column] * df["d_albedo"]
    df["delta_LST_adj"] = df["dLST_adj"]
    return df[["delta_SWabs", "delta_LST_adj"]]


def choose_bandwidth(x: np.ndarray) -> float:
    q75, q25 = np.percentile(x, [75, 25])
    iqr = q75 - q25
    bandwidth = max(0.6, 0.35 * iqr)
    return float(bandwidth)


def bootstrap_band(
    x: np.ndarray,
    y: np.ndarray,
    grid: np.ndarray,
    bandwidth: float,
    n_bootstrap: int,
    seed: int,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    rng = np.random.default_rng(seed)
    smooth = gaussian_kernel_regression(x, y, grid, bandwidth)
    boot = np.empty((n_bootstrap, grid.size), dtype=float)

    for i in range(n_bootstrap):
        sample_idx = rng.integers(0, x.size, x.size)
        boot[i] = gaussian_kernel_regression(
            x[sample_idx],
            y[sample_idx],
            grid,
            bandwidth,
        )

    lower = np.percentile(boot, 2.5, axis=0)
    upper = np.percentile(boot, 97.5, axis=0)
    return smooth, lower, upper


def round_axis_limit(value: float) -> float:
    return float(np.ceil(abs(value) * 2.0) / 2.0)


def plot_panel_c(
    df: pd.DataFrame,
    output_png: Path,
    output_tif: Path,
    display_quantile: float,
    n_bootstrap: int,
    seed: int,
) -> dict[str, float]:
    x = df["delta_SWabs"].to_numpy(dtype=float)
    y = df["delta_LST_adj"].to_numpy(dtype=float)

    bandwidth = choose_bandwidth(x)
    q_low, q_high = np.quantile(x, [display_quantile, 1.0 - display_quantile])
    grid = np.linspace(q_low, q_high, 300)
    smooth, lower, upper = bootstrap_band(x, y, grid, bandwidth, n_bootstrap, seed)

    x_limit = round_axis_limit(max(abs(q_low), abs(q_high)))
    y_limit = round_axis_limit(
        max(
            abs(np.quantile(y, 0.02)),
            abs(np.quantile(y, 0.98)),
            abs(lower.min()),
            abs(upper.max()),
        )
    )

    plt.rcParams.update(
        {
            "font.family": "DejaVu Sans",
            "axes.spines.top": False,
            "axes.spines.right": False,
            "axes.linewidth": 1.1,
            "axes.labelsize": 14,
            "xtick.labelsize": 11,
            "ytick.labelsize": 11,
        }
    )

    fig, ax = plt.subplots(figsize=(7.2, 5.4), dpi=300)
    ax.fill_between(grid, lower, upper, color="#cfe3f6", alpha=0.95, linewidth=0)
    ax.plot(grid, smooth, color="#2b6cb0", linewidth=2.3)
    ax.axhline(0, color="#7f7f7f", linestyle=(0, (4, 4)), linewidth=1.3)

    ax.set_xlim(-x_limit, x_limit)
    ax.set_ylim(-y_limit, y_limit)
    ax.set_xlabel(r"$\Delta \mathrm{SW}_{\mathrm{abs}}$ (W m$^{-2}$)")
    ax.set_ylabel(r"$\Delta \mathrm{LST}_{\mathrm{adj}}$ ($^\circ$C)")
    ax.set_title("c  SW forcing explains thermal response", loc="left", fontsize=18, fontweight="bold")

    fig.tight_layout()
    output_png.parent.mkdir(parents=True, exist_ok=True)
    output_tif.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(output_png, dpi=300, bbox_inches="tight")
    fig.savefig(output_tif, dpi=300, bbox_inches="tight")
    plt.close(fig)

    return {
        "n": float(x.size),
        "bandwidth": bandwidth,
        "x_q_low": float(q_low),
        "x_q_high": float(q_high),
        "corr": float(np.corrcoef(x, y)[0, 1]),
    }


def main() -> None:
    args = parse_args()
    df = build_dataframe(args.source)
    stats = plot_panel_c(
        df=df,
        output_png=args.output_png,
        output_tif=args.output_tif,
        display_quantile=args.display_quantile,
        n_bootstrap=args.bootstrap,
        seed=args.seed,
    )

    print(f"Source: {args.source}")
    print(f"Rows used: {int(stats['n'])}")
    print(f"Bandwidth: {stats['bandwidth']:.3f}")
    print(
        "Displayed x-range: "
        f"{stats['x_q_low']:.3f} to {stats['x_q_high']:.3f} W m^-2"
    )
    print(f"Pearson r (all rows): {stats['corr']:.3f}")
    print(f"Saved PNG: {args.output_png}")
    print(f"Saved TIF: {args.output_tif}")


if __name__ == "__main__":
    main()
