"""
ArcGIS script tool 2:
Interpolate Beijing population distribution from centroid points with Spline.

Recommended script tool parameters:
0 Input point layer
1 Population field, e.g. POP2000, POP2010, or POP2020
2 Cell size / interpolation point spacing. Example: 1000
3 Output folder
4 Output raster name. Example: bj_pop2020_spline.tif
5 Optional administrative mask polygon, e.g. Beijing boundary or districts
"""

from __future__ import annotations

import os

import arcpy
from arcpy.sa import ExtractByMask, Spline


def spline_interpolation(
    point_layer,
    interpolation_field,
    cell_size_text,
    out_folder,
    out_name,
    mask_polygon=None,
):
    if not out_folder:
        out_folder = os.path.dirname(os.path.abspath(__file__))
    os.makedirs(out_folder, exist_ok=True)
    out_raster = os.path.join(out_folder, out_name)

    arcpy.env.overwriteOutput = True
    arcpy.CheckOutExtension("Spatial")

    try:
        cell_size = float(cell_size_text)
        if cell_size <= 0:
            raise ValueError
    except ValueError:
        raise arcpy.ExecuteError("Cell size / interpolation point spacing must be positive.")

    if not arcpy.Exists(point_layer):
        raise arcpy.ExecuteError("Input point layer does not exist: {}".format(point_layer))

    field_names = [field.name.upper() for field in arcpy.ListFields(point_layer)]
    if interpolation_field.upper() not in field_names:
        raise arcpy.ExecuteError(
            "Field {} does not exist in {}".format(interpolation_field, point_layer)
        )

    arcpy.AddMessage("Running Spline interpolation...")
    raster = Spline(point_layer, interpolation_field, cell_size)

    if mask_polygon:
        arcpy.AddMessage("Extracting raster by mask...")
        raster = ExtractByMask(raster, mask_polygon)

    raster.save(out_raster)
    arcpy.AddMessage("Output raster: {}".format(out_raster))

    arcpy.CheckInExtension("Spatial")
    return out_raster


def main():
    point_layer = arcpy.GetParameterAsText(0)
    interpolation_field = arcpy.GetParameterAsText(1) or "POP2020"
    cell_size_text = arcpy.GetParameterAsText(2) or "1000"
    out_folder = arcpy.GetParameterAsText(3)
    out_name = arcpy.GetParameterAsText(4) or "bj_population_spline.tif"
    mask_polygon = arcpy.GetParameterAsText(5)
    out_raster = spline_interpolation(
        point_layer, interpolation_field, cell_size_text, out_folder, out_name, mask_polygon
    )
    arcpy.SetParameterAsText(6, out_raster)


if __name__ == "__main__":
    main()
