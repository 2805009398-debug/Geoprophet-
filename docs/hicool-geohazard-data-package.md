# HiCool 地灾数据包说明

本数据包面向 GeoProphet / HiCool 项目的滑坡、崩塌、泥石流场景，优先采用 NASA Earthdata 与 USGS 的公开权威数据。它不是完整的中国地灾隐患点库，而是用于项目演示、模型验证、遥感因子构建和方案可信度支撑的公开数据底座。

## 研究区

| 区域 | 建议范围 | 项目用途 |
| --- | --- | --- |
| 东北重点区 | `115E,38N,135E,54N` | 白山市、长白山、东部山区、冻融与降雨诱发地灾演示 |
| 西南重点区 | `97E,21N,111E,34N` | 四川、云南、贵州、重庆等滑坡/崩塌/泥石流高发区 |
| 西南扩展区 | `73E,21N,111E,36N` | 含西藏及横断山区扩展研究 |

## 已落地数据

当前已从 NASA COOLR 点位服务抓取中国滑坡事件，并按东北/西南范围生成子集：

| 文件 | 说明 |
| --- | --- |
| `data/geohazards/nasa_coolr_china_landslide_events.csv` | NASA COOLR 中国事件点 CSV，共 386 条 |
| `data/geohazards/nasa_coolr_china_landslide_events.geojson` | NASA COOLR 中国事件点 GeoJSON |
| `data/geohazards/nasa_coolr_china_southwest_bbox_73_21_111_36.csv` | 西南扩展区子集，共 25 条 |
| `data/geohazards/nasa_coolr_china_southwest_bbox_73_21_111_36.geojson` | 西南扩展区 GeoJSON |
| `data/geohazards/nasa_coolr_china_northeast_bbox_115_38_135_54.csv` | 东北重点区子集，当前为 0 条 |
| `data/geohazards/nasa_coolr_china_northeast_bbox_115_38_135_54.geojson` | 东北重点区 GeoJSON，当前为空集合 |

注意：COOLR 对中国东北覆盖很弱，对西南也远不完整。它适合做公开样本补充、演示图层和外部验证，不宜直接作为完整训练集或业务隐患点库。

## 本次已下载成果

本项目已在 `data/geohazards/` 下完成一批可直接使用的数据下载。完整文件清单见 `data/geohazards/download_manifest.csv`。

| 数据 | 下载结果 |
| --- | --- |
| NASA COOLR Events | 全球点位 40,310 条；全球面样本 20,000 条；中国 386 条，西南扩展区 25 条，东北区 0 条 |
| NASA COOLR Reports | 全球点位 14,753 条；全球面 48 条；中国 575 条，西南扩展区 312 条，西南核心区 271 条，东北区 14 条 |
| NASA LHASA Exposure | 中国 344 个行政区记录，西南扩展区 116 个，西南核心区 90 个，东北区 55 个 |
| NASA LHASA Hazard | 已下载 Yesterday / Today / Tomorrow 三期 GeoTIFF，覆盖东北、西南核心区、西南扩展区，并额外下载亚洲扩展分块 12 幅 |
| NASA Global Landslide Susceptibility | 已下载全球 GeoTIFF，并裁剪出东北、西南核心区、西南扩展区 |
| USGS Landsat C2 L2 SR | 已下载东北白山市和西南云南红河低云量示例场景 STAC、浏览图和 MTL 元数据 |

NASADEM、GPM IMERG、HLS、Sentinel-1 原始影像通常需要 Earthdata 或 USGS 登录授权，当前环境未配置相关账号，因此未直接下载原始大体量产品。

## PostGIS 入库状态

地灾空间数据已接入 PostgreSQL + PostGIS：

| 对象 | 数量 |
| --- | ---: |
| 数据集目录 | 10 |
| 文件资产 | 69 |
| 可预览图层 | 10 |
| 矢量要素 | 76,239 |
| 栅格资产元数据 | 25 |

矢量要素写入 `geohazard.features`，包含 PostGIS `geom` 和 `centroid` 字段；GeoTIFF 等大文件仍保留在文件系统中，PostGIS 存储路径、范围和栅格元数据。

## 项目推荐数据层

| 层级 | 数据 | 推荐用途 |
| --- | --- | --- |
| 灾害样本层 | NASA COOLR / Global Landslide Catalog | 展示公开滑坡样本、验证模型输出、补充案例库 |
| 地形孕灾层 | NASADEM / SRTM 30 m | 生成坡度、坡向、曲率、高程、地形起伏度 |
| 降雨触发层 | GPM IMERG | 计算事件前 1/3/7/15/30 天累计降雨和雨强 |
| 遥感变化层 | Landsat Collection 2 Level-2、HLS、OPERA DIST | 检测植被破坏、裸地扩张、滑坡扰动斑块 |
| SAR 辅助层 | Sentinel-1 via NASA ASF | 多云山区形变和灾后变化检测 |
| 区域危险性层 | NASA LHASA、Global Landslide Susceptibility | 作为区域级先验危险性图层和演示底图 |

## 与现有系统的对应关系

| HiCool 功能 | 可接入数据 | 建议说明 |
| --- | --- | --- |
| 数据接收与管理中心 | 数据目录、COOLR GeoJSON、遥感专题图层 | 展示多源接入能力，包括传感器、遥感、群众上报、公开灾害库 |
| 监测点地图 | 东北白山市演示点 + NASA/USGS 因子图层 | 东北暂无 COOLR 样本，可保留内置业务演示点，叠加 DEM/降雨/遥感风险因子 |
| 智能研判 | Landsat/HLS 图片、无人机/现场图片、COOLR 点位 | 用公开事件点做样本验证，用图像上传工作台展示滑坡识别 |
| 预警中心 | GPM IMERG、LHASA、SMAP、传感器雨量/位移 | 做降雨触发和多源融合预警叙事 |
| 影响评估 | DEM、土地覆盖、道路/居民点数据 | NASA/USGS 不提供完整中国承灾体，需要补充 OSM 或地方数据 |

## 数据获取入口

- NASA COOLR / Landslides: https://gpm.nasa.gov/applications/landslides/coolr
- NASA Earthdata Search: https://search.earthdata.nasa.gov/search
- NASA AppEEARS: https://appeears.earthdatacloud.nasa.gov/
- NASA GPM IMERG: https://gpm.nasa.gov/data/imerg
- NASA LP DAAC: https://www.earthdata.nasa.gov/centers/lp-daac
- NASA HLS: https://hls.gsfc.nasa.gov/
- NASA ASF Vertex: https://search.asf.alaska.edu/
- NASA OPERA DIST: https://www.jpl.nasa.gov/go/opera/products/dist-product-suite/
- USGS EarthExplorer: https://earthexplorer.usgs.gov/
- USGS Landsat Collection 2 Level-2: https://www.usgs.gov/landsat-missions/landsat-collection-2-level-2-science-products

## 建议落地路线

1. 短期演示：使用现有白山市内置监测点作为业务底座，叠加 COOLR 中国/西南事件点和 NASA/USGS 数据目录。
2. 中期模型：下载西南山区的 Landsat/HLS 前后时相影像、NASADEM、GPM IMERG，构建滑坡识别和易发性样本。
3. 生产化：引入地方地灾隐患点、自然资源部门历史灾情、实地巡查和群众上报数据，NASA/USGS 数据作为遥感和触发因子支撑。

## 风险提示

- NASA COOLR 主要来自新闻、志愿上报和研究清单，存在漏报和空间偏差。
- NASA/USGS 公开数据通常没有中国行政区打包，需要按 bbox 或矢量边界裁剪。
- 崩塌、滑坡、泥石流在公开全球库中经常被合并为 landslide，若项目需要精细分类，需要本地标注或专家校核。
- 原始遥感影像量较大，建议先以 1-2 个示范区做样例，再扩展到全东北/西南。
