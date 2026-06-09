# 北京市街道镇人口插值与制图作业说明

## 文件清单

- `北京市街道镇人口数据.xlsx`：根据 CityPopulation.de 北京乡镇级页面整理的人口表。
- `北京市街道镇人口数据.csv`：同内容 CSV 备份，供 ArcGIS 脚本稳定读取属性。
- `01_download_population_excel.py`：重新下载并生成 Excel 的脚本。
- `02_create_centroid_points.py`：脚本工具 1，生成街道（镇）质心点 shapefile 并添加人口属性。
- `03_spline_interpolation.py`：脚本工具 2，按用户选择的人口字段执行 Spline 插值。
- `04_make_district_population_maps.py`：批量绘制 16 个区县人口分布图的脚本，可使用指定 `.aprx` 模板，或使用 ArcGIS Pro 当前打开工程的第一个布局。
- `05_create_centroids_with_ogr.py`：不依赖 ArcPy 的质心点生成脚本，已在本机用 QGIS/GDAL 运行。
- `bj_township_centroids_ogr.shp/.shx/.dbf/.prj/.cpg`：已实际生成的街道镇质心点 shapefile。
- `BeijingPopulationTools.pyt`：ArcGIS Python Toolbox，包含 3 个脚本工具和 1 个模型工具。
- `模型工具流程.txt`：附加题模型工具流程说明。

## Excel 字段

Excel 包含作业要求的 5 个字段：

- 街道（镇）名称
- 所属县区
- 2000年人口
- 2010年人口
- 2020年人口

网页源数据同时包含街道、镇、乡、地区、类似乡级单位。为保证北京市街道（镇）级行政区域完整，Excel 保留了这些乡镇级记录，剔除了北京市和区级汇总行。

## 已生成质心点数据

本机已检测到乡镇面数据：

- `D:\bjmap\bjmap\乡镇.shp`

已使用 `05_create_centroids_with_ogr.py` 生成：

- `bj_township_centroids_ogr.shp`

该 shapefile 共 314 个点，字段为 `TOWN_NAME`、`DISTRICT`、`POP2000`、`POP2010`、`POP2020`。其中 308 个点成功匹配网页人口表；剩余少量记录是源 shp 与网页统计口径或旧区划归属不一致导致，例如 `朝阳区-建国门外街道`、`朝阳区-望京开发街道`、`西城区-清河街道`、`昌平区-长陵镇`。

## ArcGIS 使用步骤

1. 在 ArcGIS Pro/ArcMap 中添加 `BeijingPopulationTools.pyt`。
2. 运行“1 创建街道镇质心点并添加人口属性”：
   - 选择行政区域：`D:\bjmap\bjmap\乡镇.shp`
   - 输出目录：自选
   - 输出 shape 文件名：例如 `bj_township_centroids.shp`
- 人口 Excel 文件：默认使用本目录的 `北京市街道镇人口数据.xlsx`
3. 运行“2 Spline 人口插值”：
   - 点图层：上一步生成的质心点
   - 插值字段：`POP2000`、`POP2010` 或 `POP2020`
   - 插值点数/像元大小：例如 `1000`
   - 插值结果目录与文件：自选，例如 `bj_pop2020_spline.tif`
   - 裁剪范围：可选择北京市或区县边界
4. 运行“3 批量制作区县人口分布图”：
   - 区县行政区边界：选择区县级面数据
   - 区县名称字段：选择区县名称字段
   - 质心点图层：第 1 步输出
   - 人口分布栅格：第 2 步输出
   - 输出地图目录：自选
   - 绘图模板 APRX：可选。若不填，工具会使用当前 ArcGIS Pro 工程的第一个地图和第一个布局。

## 绘图模板制作方法

1. 在 ArcGIS Pro 新建一个工程，插入一个 Map 和一个 Layout。
2. 在 Layout 中插入 Map Frame、图例、比例尺、指北针。
3. 插入标题文本，并将该文本元素的名称改为 `Title`。
4. 保存为 `beijing_population_map_template.aprx`，运行“3 批量制作区县人口分布图”时选择该模板。

## 注意事项

- 当前电脑环境未检测到 ArcPy，因此 ArcGIS 的 Spline 插值栅格和批量地图需要在安装 ArcGIS 的环境中运行生成。本机已检测到 `D:\bjmap\bjmap\乡镇.shp`，并额外提供了 OGR 版脚本生成质心点 shapefile。
- 质心点输出字段采用 shapefile 兼容字段名：`TOWN_NAME`、`DISTRICT`、`POP2000`、`POP2010`、`POP2020`。
- 如果 `D:\bjmap\bjmap\乡镇.shp` 的街镇名称字段不是常见字段名，可在 `02_create_centroid_points.py` 顶部的 `NAME_CANDIDATES`、`DISTRICT_CANDIDATES` 中增加实际字段名。
