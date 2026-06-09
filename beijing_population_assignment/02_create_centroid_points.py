"""
ArcGIS script tool 1:
Create township centroid points for Beijing and append population attributes.

Recommended script tool parameters:
0 Input township polygon layer/shapefile, e.g. D:\\bjmap\\bjmap\\乡镇.shp
1 Output folder
2 Output shapefile name, e.g. bj_township_centroids.shp
3 Population Excel file, default 北京市街道镇人口数据.xlsx

The script writes these shapefile-friendly fields:
    TOWN_NAME, DISTRICT, POP2000, POP2010, POP2020
"""

from __future__ import annotations

import os
import re
import sys
import csv

import arcpy


SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_EXCEL = os.path.join(SCRIPT_DIR, "北京市街道镇人口数据.xlsx")

NAME_CANDIDATES = [
    "街道（镇）名称",
    "街道镇名称",
    "TOWN_NAME",
    "TOWN",
    "乡镇名称",
    "乡镇名",
    "名称",
    "NAME",
    "Name",
]
DISTRICT_CANDIDATES = [
    "所属县区",
    "DISTRICT",
    "区县",
    "县区",
    "区县名称",
    "所属区县",
    "COUNTY",
    "County",
]


def msg(text):
    arcpy.AddMessage(str(text))


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


def find_field(dataset, candidates, required=True):
    field_map = {}
    for field in arcpy.ListFields(dataset):
        field_map[field.name.lower()] = field.name
        if getattr(field, "aliasName", None):
            field_map[field.aliasName.lower()] = field.name
    for candidate in candidates:
        found = field_map.get(candidate.lower())
        if found:
            return found
    if required:
        raise arcpy.ExecuteError(
            "Cannot find required field. Tried: {}".format(", ".join(candidates))
        )
    return None


def number_or_none(value):
    if value in (None, ""):
        return None
    try:
        return int(float(str(value).replace(",", "")))
    except ValueError:
        return None


def add_or_replace_field(dataset, field_name, field_type, length=None):
    existing = {field.name.upper() for field in arcpy.ListFields(dataset)}
    if field_name.upper() in existing:
        arcpy.management.DeleteField(dataset, field_name)
    kwargs = {}
    if length:
        kwargs["field_length"] = length
    arcpy.management.AddField(dataset, field_name, field_type, **kwargs)


def load_population_dict(excel_file):
    csv_file = os.path.splitext(excel_file)[0] + ".csv"
    if os.path.exists(csv_file):
        data = {}
        with open(csv_file, "r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle)
            for row in reader:
                town = row.get("街道（镇）名称") or row.get("街道镇名称")
                district = row.get("所属县区")
                value = (
                    clean_name(town),
                    clean_name(district),
                    number_or_none(row.get("2000年人口")),
                    number_or_none(row.get("2010年人口")),
                    number_or_none(row.get("2020年人口")),
                )
                keys = {
                    (clean_name(town), clean_name(district)),
                    (short_name(town), clean_name(district)),
                    (clean_name(town), short_name(district)),
                    (short_name(town), short_name(district)),
                }
                for key in keys:
                    data[key] = value
        msg("Loaded population rows from CSV: {}".format(len(data)))
        return data

    table_view = "population_excel_view"
    arcpy.management.MakeTableView(excel_file, table_view)

    fields = [field.name for field in arcpy.ListFields(table_view)]
    town_field = find_field(table_view, ["街道（镇）名称", "街道镇名称"])
    district_field = find_field(table_view, ["所属县区"])
    pop2000 = find_field(table_view, ["2000年人口"])
    pop2010 = find_field(table_view, ["2010年人口"])
    pop2020 = find_field(table_view, ["2020年人口"])

    data = {}
    with arcpy.da.SearchCursor(
        table_view, [town_field, district_field, pop2000, pop2010, pop2020]
    ) as cursor:
        for town, district, p2000, p2010, p2020 in cursor:
            keys = {
                (clean_name(town), clean_name(district)),
                (short_name(town), clean_name(district)),
                (clean_name(town), short_name(district)),
                (short_name(town), short_name(district)),
            }
            value = (clean_name(town), clean_name(district), p2000, p2010, p2020)
            for key in keys:
                data[key] = value

    msg("Loaded population rows: {}".format(len(data)))
    return data


def create_centroid_points(township_fc, out_folder, out_name, excel_file=DEFAULT_EXCEL):
    if not out_name.lower().endswith(".shp"):
        out_name += ".shp"
    out_fc = os.path.join(out_folder, out_name)

    arcpy.env.overwriteOutput = True
    os.makedirs(out_folder, exist_ok=True)

    if not arcpy.Exists(township_fc):
        raise arcpy.ExecuteError("Input township data does not exist: {}".format(township_fc))
    if not os.path.exists(excel_file):
        raise arcpy.ExecuteError("Population Excel does not exist: {}".format(excel_file))

    msg("Creating centroid points...")
    arcpy.management.FeatureToPoint(township_fc, out_fc, "INSIDE")

    source_name_field = find_field(out_fc, NAME_CANDIDATES)
    source_district_field = find_field(out_fc, DISTRICT_CANDIDATES, required=False)
    population = load_population_dict(excel_file)

    add_or_replace_field(out_fc, "TOWN_NAME", "TEXT", 50)
    add_or_replace_field(out_fc, "DISTRICT", "TEXT", 50)
    add_or_replace_field(out_fc, "POP2000", "LONG")
    add_or_replace_field(out_fc, "POP2010", "LONG")
    add_or_replace_field(out_fc, "POP2020", "LONG")

    fields = [source_name_field]
    if source_district_field:
        fields.append(source_district_field)
    fields += ["TOWN_NAME", "DISTRICT", "POP2000", "POP2010", "POP2020"]

    matched = 0
    missing = []
    with arcpy.da.UpdateCursor(out_fc, fields) as cursor:
        for row in cursor:
            source_town = row[0]
            source_district = row[1] if source_district_field else ""
            key_options = [
                (clean_name(source_town), clean_name(source_district)),
                (short_name(source_town), clean_name(source_district)),
                (clean_name(source_town), short_name(source_district)),
                (short_name(source_town), short_name(source_district)),
            ]
            record = None
            for key in key_options:
                if key in population:
                    record = population[key]
                    break

            if record is None and not source_district_field:
                candidates = [
                    value
                    for key, value in population.items()
                    if key[0] in {clean_name(source_town), short_name(source_town)}
                ]
                if len(candidates) == 1:
                    record = candidates[0]

            base_index = 2 if source_district_field else 1
            if record:
                row[base_index : base_index + 5] = list(record)
                matched += 1
            else:
                row[base_index] = clean_name(source_town)
                row[base_index + 1] = clean_name(source_district)
                missing.append(clean_name(source_town))
            cursor.updateRow(row)

    msg("Output: {}".format(out_fc))
    msg("Matched population records: {}".format(matched))
    if missing:
        arcpy.AddWarning(
            "Unmatched township names (first 30): {}".format(", ".join(missing[:30]))
        )
    return out_fc


def main():
    township_fc = arcpy.GetParameterAsText(0) or r"D:\bjmap\bjmap\乡镇.shp"
    out_folder = arcpy.GetParameterAsText(1) or SCRIPT_DIR
    out_name = arcpy.GetParameterAsText(2) or "bj_township_centroids.shp"
    excel_file = arcpy.GetParameterAsText(3) or DEFAULT_EXCEL
    out_fc = create_centroid_points(township_fc, out_folder, out_name, excel_file)
    arcpy.SetParameterAsText(4, out_fc)


if __name__ == "__main__":
    main()
