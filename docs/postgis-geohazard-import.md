# PostGIS 地灾数据入库说明

HiCool 项目现在采用 PostgreSQL + PostGIS 作为地灾空间数据主库。业务演示数据仍保留 SQLite，NASA/USGS 地灾矢量要素和栅格资产元数据进入 PostGIS。

## 表结构

Schema 文件：

- `backend/db/postgis.sql`

主要表：

- `geohazard.datasets`：数据集目录
- `geohazard.regions`：东北/西南研究区 bbox
- `geohazard.data_assets`：下载文件资产清单
- `geohazard.layers`：前端可预览图层元数据
- `geohazard.features`：COOLR / LHASA 矢量要素，含 PostGIS geometry
- `geohazard.raster_assets`：GeoTIFF 等栅格资产元数据和路径

## 本地启动

```bash
docker compose up -d postgis
```

默认连接：

```text
postgres://geoprophet:geoprophet@127.0.0.1:5432/geoprophet
```

## 导入数据

```bash
POSTGIS_DATABASE_URL=postgres://geoprophet:geoprophet@127.0.0.1:5432/geoprophet npm run geohazards:import-postgis --workspace backend
```

当前导入结果：

```text
datasets: 10
assets: 69
layers: 10
features: 76239
rasters: 25
```

## 后端读取

配置：

```text
POSTGIS_DATABASE_URL=postgres://geoprophet:geoprophet@127.0.0.1:5432/geoprophet
GEOHAZARDS_PREFER_POSTGIS=true
```

接口：

- `GET /api/geohazards/overview`
- `GET /api/geohazards/layers/:layerId`

如果 PostGIS 不可用，接口会回退到 `data/geohazards/` 文件读取。
