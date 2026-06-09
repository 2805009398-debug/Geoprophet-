"""
Python toolbox for the Beijing population assignment.

Add this .pyt in ArcGIS Pro/ArcMap, then run the tools in order:
1. CreateTownshipCentroids
2. SplinePopulationInterpolation
3. MakeDistrictPopulationMaps
4. Model_CentroidsToSpline
"""

from __future__ import annotations

import os
import subprocess
import sys

import arcpy


TOOLBOX_DIR = os.path.dirname(os.path.abspath(__file__))


class Toolbox(object):
    def __init__(self):
        self.label = "Beijing Population Tools"
        self.alias = "bjpop"
        self.tools = [
            CreateTownshipCentroids,
            SplinePopulationInterpolation,
            MakeDistrictPopulationMaps,
            Model_CentroidsToSpline,
        ]


class _BaseTool(object):
    script_name = ""

    def run_script(self, parameters):
        script = os.path.join(TOOLBOX_DIR, self.script_name)
        values = [p.valueAsText or "" for p in parameters]
        subprocess.check_call([sys.executable, script] + values)

    def isLicensed(self):
        return True

    def updateParameters(self, parameters):
        return

    def updateMessages(self, parameters):
        return


class CreateTownshipCentroids(_BaseTool):
    label = "1 创建街道镇质心点并添加人口属性"
    description = "提取北京市街道（镇）级行政区域质心点，并从 Excel 添加 2000/2010/2020 年人口属性。"
    canRunInBackground = False
    script_name = "02_create_centroid_points.py"

    def getParameterInfo(self):
        p0 = arcpy.Parameter(
            displayName="选择行政区域",
            name="township_fc",
            datatype="DEFeatureClass",
            parameterType="Required",
            direction="Input",
        )
        p0.value = r"D:\bjmap\bjmap\乡镇.shp"
        p1 = arcpy.Parameter(
            displayName="输出目录",
            name="out_folder",
            datatype="DEFolder",
            parameterType="Required",
            direction="Input",
        )
        p2 = arcpy.Parameter(
            displayName="输出 shape 文件名",
            name="out_name",
            datatype="GPString",
            parameterType="Required",
            direction="Input",
        )
        p2.value = "bj_township_centroids.shp"
        p3 = arcpy.Parameter(
            displayName="人口 Excel 文件",
            name="excel_file",
            datatype="DEFile",
            parameterType="Optional",
            direction="Input",
        )
        p3.value = os.path.join(TOOLBOX_DIR, "北京市街道镇人口数据.xlsx")
        p4 = arcpy.Parameter(
            displayName="输出质心点",
            name="out_centroids",
            datatype="DEFeatureClass",
            parameterType="Derived",
            direction="Output",
        )
        return [p0, p1, p2, p3, p4]

    def execute(self, parameters, messages):
        import importlib.util

        script = os.path.join(TOOLBOX_DIR, self.script_name)
        spec = importlib.util.spec_from_file_location("create_centroids", script)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        out_fc = module.create_centroid_points(
            parameters[0].valueAsText,
            parameters[1].valueAsText,
            parameters[2].valueAsText,
            parameters[3].valueAsText or os.path.join(TOOLBOX_DIR, "北京市街道镇人口数据.xlsx"),
        )
        parameters[4].value = out_fc


class SplinePopulationInterpolation(_BaseTool):
    label = "2 Spline 人口插值"
    description = "允许用户选择不同年份人口字段进行 Spline 插值，生成北京市人口分布栅格。"
    canRunInBackground = False
    script_name = "03_spline_interpolation.py"

    def getParameterInfo(self):
        p0 = arcpy.Parameter(
            displayName="点图层",
            name="point_layer",
            datatype="DEFeatureClass",
            parameterType="Required",
            direction="Input",
        )
        p1 = arcpy.Parameter(
            displayName="插值字段",
            name="interpolation_field",
            datatype="Field",
            parameterType="Required",
            direction="Input",
        )
        p1.parameterDependencies = [p0.name]
        p1.filter.list = ["Short", "Long", "Float", "Double"]
        p1.value = "POP2020"
        p2 = arcpy.Parameter(
            displayName="插值点数/像元大小",
            name="cell_size",
            datatype="GPDouble",
            parameterType="Required",
            direction="Input",
        )
        p2.value = 1000
        p3 = arcpy.Parameter(
            displayName="插值结果目录",
            name="out_folder",
            datatype="DEFolder",
            parameterType="Required",
            direction="Input",
        )
        p4 = arcpy.Parameter(
            displayName="插值结果文件",
            name="out_name",
            datatype="GPString",
            parameterType="Required",
            direction="Input",
        )
        p4.value = "bj_population_spline.tif"
        p5 = arcpy.Parameter(
            displayName="裁剪范围（可选）",
            name="mask_polygon",
            datatype="DEFeatureClass",
            parameterType="Optional",
            direction="Input",
        )
        p6 = arcpy.Parameter(
            displayName="输出插值栅格",
            name="out_raster",
            datatype="DERasterDataset",
            parameterType="Derived",
            direction="Output",
        )
        return [p0, p1, p2, p3, p4, p5, p6]

    def execute(self, parameters, messages):
        import importlib.util

        script = os.path.join(TOOLBOX_DIR, self.script_name)
        spec = importlib.util.spec_from_file_location("spline_interpolation", script)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        out_raster = module.spline_interpolation(
            parameters[0].valueAsText,
            parameters[1].valueAsText,
            parameters[2].valueAsText,
            parameters[3].valueAsText,
            parameters[4].valueAsText,
            parameters[5].valueAsText,
        )
        parameters[6].value = out_raster


class MakeDistrictPopulationMaps(_BaseTool):
    label = "3 批量制作区县人口分布图"
    description = "按 16 个区县裁剪人口分布栅格，并导出每个区县的人口分布图。"
    canRunInBackground = False
    script_name = "04_make_district_population_maps.py"

    def getParameterInfo(self):
        p0 = arcpy.Parameter(
            displayName="区县行政区边界",
            name="district_fc",
            datatype="DEFeatureClass",
            parameterType="Required",
            direction="Input",
        )
        p1 = arcpy.Parameter(
            displayName="区县名称字段",
            name="district_name_field",
            datatype="Field",
            parameterType="Required",
            direction="Input",
        )
        p1.parameterDependencies = [p0.name]
        p2 = arcpy.Parameter(
            displayName="质心点图层",
            name="centroid_points",
            datatype="DEFeatureClass",
            parameterType="Required",
            direction="Input",
        )
        p3 = arcpy.Parameter(
            displayName="人口分布栅格",
            name="population_raster",
            datatype="DERasterDataset",
            parameterType="Required",
            direction="Input",
        )
        p4 = arcpy.Parameter(
            displayName="输出地图目录",
            name="out_folder",
            datatype="DEFolder",
            parameterType="Required",
            direction="Input",
        )
        p5 = arcpy.Parameter(
            displayName="绘图模板 APRX",
            name="template_aprx",
            datatype="DEFile",
            parameterType="Optional",
            direction="Input",
        )
        return [p0, p1, p2, p3, p4, p5]

    def execute(self, parameters, messages):
        import importlib.util

        script = os.path.join(TOOLBOX_DIR, self.script_name)
        spec = importlib.util.spec_from_file_location("make_maps", script)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        module.make_district_population_maps(
            parameters[0].valueAsText,
            parameters[1].valueAsText,
            parameters[2].valueAsText,
            parameters[3].valueAsText,
            parameters[4].valueAsText,
            parameters[5].valueAsText or "",
        )


class Model_CentroidsToSpline(_BaseTool):
    label = "4 模型工具：质心点到 Spline 插值"
    description = "附加题模型工具：将脚本工具 1 的输出结果作为脚本工具 2 的输入。"
    canRunInBackground = False

    def getParameterInfo(self):
        p0 = arcpy.Parameter(
            displayName="选择行政区域",
            name="township_fc",
            datatype="DEFeatureClass",
            parameterType="Required",
            direction="Input",
        )
        p0.value = r"D:\bjmap\bjmap\乡镇.shp"
        p1 = arcpy.Parameter(
            displayName="人口 Excel 文件",
            name="excel_file",
            datatype="DEFile",
            parameterType="Optional",
            direction="Input",
        )
        p1.value = os.path.join(TOOLBOX_DIR, "北京市街道镇人口数据.xlsx")
        p2 = arcpy.Parameter(
            displayName="输出目录",
            name="out_folder",
            datatype="DEFolder",
            parameterType="Required",
            direction="Input",
        )
        p3 = arcpy.Parameter(
            displayName="输出质心 shape 文件名",
            name="centroid_name",
            datatype="GPString",
            parameterType="Required",
            direction="Input",
        )
        p3.value = "bj_township_centroids.shp"
        p4 = arcpy.Parameter(
            displayName="插值字段",
            name="interpolation_field",
            datatype="GPString",
            parameterType="Required",
            direction="Input",
        )
        p4.filter.type = "ValueList"
        p4.filter.list = ["POP2000", "POP2010", "POP2020"]
        p4.value = "POP2020"
        p5 = arcpy.Parameter(
            displayName="插值点数/像元大小",
            name="cell_size",
            datatype="GPDouble",
            parameterType="Required",
            direction="Input",
        )
        p5.value = 1000
        p6 = arcpy.Parameter(
            displayName="插值结果文件",
            name="raster_name",
            datatype="GPString",
            parameterType="Required",
            direction="Input",
        )
        p6.value = "bj_population_spline.tif"
        p7 = arcpy.Parameter(
            displayName="裁剪范围（可选）",
            name="mask_polygon",
            datatype="DEFeatureClass",
            parameterType="Optional",
            direction="Input",
        )
        p8 = arcpy.Parameter(
            displayName="输出插值栅格",
            name="out_raster",
            datatype="DERasterDataset",
            parameterType="Derived",
            direction="Output",
        )
        return [p0, p1, p2, p3, p4, p5, p6, p7, p8]

    def execute(self, parameters, messages):
        import importlib.util

        centroid_script = os.path.join(TOOLBOX_DIR, "02_create_centroid_points.py")
        spline_script = os.path.join(TOOLBOX_DIR, "03_spline_interpolation.py")

        township_fc = parameters[0].valueAsText
        excel_file = parameters[1].valueAsText
        out_folder = parameters[2].valueAsText
        centroid_name = parameters[3].valueAsText
        field = parameters[4].valueAsText
        cell_size = parameters[5].valueAsText
        raster_name = parameters[6].valueAsText
        mask_polygon = parameters[7].valueAsText or ""

        spec = importlib.util.spec_from_file_location("create_centroids", centroid_script)
        centroid_module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(centroid_module)
        centroid_fc = centroid_module.create_centroid_points(
            township_fc,
            out_folder,
            centroid_name,
            excel_file or os.path.join(TOOLBOX_DIR, "北京市街道镇人口数据.xlsx"),
        )

        spec = importlib.util.spec_from_file_location("spline_interpolation", spline_script)
        spline_module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(spline_module)
        out_raster = spline_module.spline_interpolation(
            centroid_fc,
            field,
            cell_size,
            out_folder,
            raster_name,
            mask_polygon,
        )

        parameters[8].value = out_raster
