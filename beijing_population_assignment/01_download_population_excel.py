"""
Download township-level population data for Beijing from CityPopulation.de
and save it as an Excel workbook required by the assignment.

Output:
    北京市街道镇人口数据.xlsx
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd


URL = "https://www.citypopulation.de/zh/china/townships/beijing/admin/"
OUT_XLSX = Path(__file__).with_name("北京市街道镇人口数据.xlsx")
OUT_CSV = Path(__file__).with_name("北京市街道镇人口数据.csv")

DISTRICT_TYPES = {"区", "县", "市"}
TOWNSHIP_TYPES = {"街道", "镇", "乡", "地区", "类似乡级单位"}


def normalize_population(value):
    if pd.isna(value):
        return None
    text = str(value).strip().replace(",", "")
    if not text or text in {"-", "nan"}:
        return None
    try:
        return int(float(text))
    except ValueError:
        return None


def build_population_table() -> pd.DataFrame:
    table = pd.read_html(URL)[0]
    table = table.rename(
        columns={
            "地名": "街道（镇）名称",
            "类型": "类型",
            "人口 人口普查 2000-11-01": "2000年人口",
            "人口 人口普查 2010-11-01": "2010年人口",
            "人口 人口普查 2020-11-01": "2020年人口",
        }
    )

    rows = []
    current_district = None
    for _, row in table.iterrows():
        name = str(row["街道（镇）名称"]).strip()
        item_type = str(row["类型"]).strip()

        if item_type in DISTRICT_TYPES and name != "北京市":
            current_district = name
            continue
        if item_type not in TOWNSHIP_TYPES:
            continue

        rows.append(
            {
                "街道（镇）名称": name,
                "所属县区": current_district,
                "2000年人口": normalize_population(row["2000年人口"]),
                "2010年人口": normalize_population(row["2010年人口"]),
                "2020年人口": normalize_population(row["2020年人口"]),
            }
        )

    result = pd.DataFrame(rows)
    return result


def main() -> None:
    population = build_population_table()
    with pd.ExcelWriter(OUT_XLSX, engine="openpyxl") as writer:
        population.to_excel(writer, sheet_name="街道镇人口", index=False)

        workbook = writer.book
        sheet = writer.sheets["街道镇人口"]
        for column_cells in sheet.columns:
            max_len = max(len(str(cell.value or "")) for cell in column_cells)
            sheet.column_dimensions[column_cells[0].column_letter].width = max_len + 4
        sheet.freeze_panes = "A2"

    population.to_csv(OUT_CSV, index=False, encoding="utf-8-sig")
    print(f"Saved {len(population)} rows to {OUT_XLSX}")


if __name__ == "__main__":
    main()
