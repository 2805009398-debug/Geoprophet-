"""
Optional non-ArcPy helper:
Create township centroid points with GDAL/OGR and append population fields.

This file is included because the current computer has QGIS/GDAL available but
does not expose ArcPy. It produces the same attribute fields required by the
assignment:
    TOWN_NAME, DISTRICT, POP2000, POP2010, POP2020

Usage with the QGIS Python installed on this computer:
    "C:\\Program Files\\QGISQT6 3.42.3\\apps\\Python312\\python.exe" 05_create_centroids_with_ogr.py
"""

from __future__ import annotations

import csv
import os
import re
from pathlib import Path

from osgeo import ogr, osr


SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_TOWNSHIP = Path(r"D:\bjmap\bjmap\乡镇.shp")
DEFAULT_CSV = SCRIPT_DIR / "北京市街道镇人口数据.csv"
DEFAULT_OUT = SCRIPT_DIR / "bj_township_centroids_ogr.shp"

CODE_TO_DISTRICT = {
    "110101": "东城区",
    "110102": "西城区",
    "110103": "东城区",
    "110104": "西城区",
    "110105": "朝阳区",
    "110106": "丰台区",
    "110107": "石景山区",
    "110108": "海淀区",
    "110109": "门头沟区",
    "110111": "房山区",
    "110112": "通州区",
    "110113": "顺义区",
    "110114": "昌平区",
    "110115": "大兴区",
    "110116": "怀柔区",
    "110117": "平谷区",
    "110118": "密云区",
    "110119": "延庆区",
    "110228": "密云区",
    "110229": "延庆区",
    "220104": "朝阳区",
}


def clean_name(value):
    if value is None:
        return ""
    text = str(value).strip()
    text = re.sub(r"[\s　]+", "", text)
    for suffix in ("街道办事处", "办事处", "地区办事处"):
        if text.endswith(suffix):
            text = text[: -len(suffix)]
    return text


def short_name(value):
    text = clean_name(value)
    for suffix in ("街道", "镇", "乡", "地区", "区"):
        if text.endswith(suffix):
            return text[: -len(suffix)]
    return text


def name_variants(value):
    text = clean_name(value)
    variants = {text, short_name(text)}
    if "（" in text and "）" in text:
        outside = re.sub(r"（.*?）", "", text)
        inside_items = re.findall(r"（(.*?)）", text)
        variants.add(clean_name(outside))
        variants.add(short_name(outside))
        for item in inside_items:
            variants.add(clean_name(item))
            variants.add(short_name(item))
    return {item for item in variants if item}


def number_or_none(value):
    if value in (None, ""):
        return None
    try:
        return int(float(str(value).replace(",", "")))
    except ValueError:
        return None


def load_population(csv_file):
    data = {}
    with open(csv_file, "r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            town = row["街道（镇）名称"]
            district = row["所属县区"]
            record = (
                clean_name(town),
                clean_name(district),
                number_or_none(row["2000年人口"]),
                number_or_none(row["2010年人口"]),
                number_or_none(row["2020年人口"]),
            )
            keys = {
                (clean_name(town), clean_name(district)),
                (short_name(town), clean_name(district)),
                (clean_name(town), short_name(district)),
                (short_name(town), short_name(district)),
            }
            keys = {
                (town_name, district_name)
                for town_name in name_variants(town)
                for district_name in name_variants(district)
            } | keys
            for key in keys:
                data[key] = record
    return data


def district_from_code(code):
    text = str(code or "").strip()
    return CODE_TO_DISTRICT.get(text[:6], "")


def delete_shapefile(path):
    base = path.with_suffix("")
    for suffix in (".shp", ".shx", ".dbf", ".prj", ".cpg", ".qpj"):
        candidate = base.with_suffix(suffix)
        if candidate.exists():
            candidate.unlink()


def main():
    township_path = Path(os.environ.get("BJ_TOWNSHIP_SHP", DEFAULT_TOWNSHIP))
    csv_path = Path(os.environ.get("BJ_POP_CSV", DEFAULT_CSV))
    out_path = Path(os.environ.get("BJ_CENTROID_OUT", DEFAULT_OUT))

    driver = ogr.GetDriverByName("ESRI Shapefile")
    source_ds = driver.Open(str(township_path), 0)
    if source_ds is None:
        raise RuntimeError(f"Cannot open township shapefile: {township_path}")
    source_layer = source_ds.GetLayer(0)
    source_srs = source_layer.GetSpatialRef()

    delete_shapefile(out_path)
    out_ds = driver.CreateDataSource(str(out_path))
    out_layer = out_ds.CreateLayer(
        out_path.stem,
        srs=source_srs,
        geom_type=ogr.wkbPoint,
        options=["ENCODING=UTF-8"],
    )

    fields = [
        ("TOWN_NAME", ogr.OFTString, 50),
        ("DISTRICT", ogr.OFTString, 50),
        ("POP2000", ogr.OFTInteger, None),
        ("POP2010", ogr.OFTInteger, None),
        ("POP2020", ogr.OFTInteger, None),
    ]
    for name, field_type, width in fields:
        field = ogr.FieldDefn(name, field_type)
        if width:
            field.SetWidth(width)
        out_layer.CreateField(field)

    population = load_population(csv_path)
    out_defn = out_layer.GetLayerDefn()
    source_count = source_layer.GetFeatureCount()
    matched = 0
    missing = []

    for feature in source_layer:
        town = clean_name(feature.GetField("NAME"))
        district = district_from_code(feature.GetField("地区编码"))
        geometry = feature.GetGeometryRef()
        if geometry is None:
            continue
        point = geometry.PointOnSurface()

        record = None
        key_options = [
            (town_name, district_name)
            for town_name in name_variants(town)
            for district_name in name_variants(district)
        ]
        for key in key_options:
            if key in population:
                record = population[key]
                break

        if record is None:
            record = (town, district, None, None, None)
            missing.append(f"{district}-{town}")
        else:
            matched += 1

        out_feature = ogr.Feature(out_defn)
        out_feature.SetGeometry(point)
        for index, value in enumerate(record):
            if value is not None:
                out_feature.SetField(index, value)
        out_layer.CreateFeature(out_feature)
        out_feature = None

    if source_srs:
        source_srs.MorphToESRI()
        with open(out_path.with_suffix(".prj"), "w", encoding="utf-8") as handle:
            handle.write(source_srs.ExportToWkt())

    out_ds = None
    source_ds = None

    print(f"Output: {out_path}")
    print(f"Source features: {source_count}")
    print(f"Matched records: {matched}")
    if missing:
        print("Unmatched records (first 30):")
        for item in missing[:30]:
            print("  " + item)


if __name__ == "__main__":
    main()
