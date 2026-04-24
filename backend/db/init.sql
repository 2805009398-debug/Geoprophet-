PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  district TEXT NOT NULL,
  hazard_type TEXT NOT NULL,
  risk_level TEXT NOT NULL,
  status TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  last_inspection_at TEXT NOT NULL,
  description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sensors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  sensor_type TEXT NOT NULL,
  unit TEXT NOT NULL,
  status TEXT NOT NULL,
  last_value REAL NOT NULL,
  last_collected_at TEXT NOT NULL,
  UNIQUE(site_id, name),
  FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sensor_id INTEGER NOT NULL,
  observed_at TEXT NOT NULL,
  value REAL NOT NULL,
  quality TEXT NOT NULL,
  anomaly_level TEXT NOT NULL,
  FOREIGN KEY(sensor_id) REFERENCES sensors(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  severity TEXT NOT NULL,
  status TEXT NOT NULL,
  source TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TEXT NOT NULL,
  acknowledged_at TEXT,
  recommended_action TEXT NOT NULL,
  FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS crowd_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER,
  reporter_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  title TEXT NOT NULL,
  report_type TEXT NOT NULL,
  description TEXT NOT NULL,
  image_url TEXT,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  confidence_score REAL NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS analysis_models (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  version TEXT NOT NULL,
  accuracy REAL NOT NULL,
  status TEXT NOT NULL,
  last_run_at TEXT NOT NULL,
  summary TEXT NOT NULL,
  UNIQUE(name, version)
);

CREATE TABLE IF NOT EXISTS assessments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL,
  level TEXT NOT NULL,
  population_affected INTEGER NOT NULL,
  economic_loss REAL NOT NULL,
  road_impact TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS emergency_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL UNIQUE,
  level TEXT NOT NULL,
  status TEXT NOT NULL,
  leader TEXT NOT NULL,
  summary TEXT NOT NULL,
  resource_summary TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS system_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL
);

INSERT OR IGNORE INTO sites (id, code, name, district, hazard_type, risk_level, status, lat, lng, last_inspection_at, description) VALUES
  (1, 'BS-JY-001', '七道江滑坡群', '江源区', '滑坡', 'critical', 'warning', 41.908, 126.580, '2026-04-22 15:10:00', '居民点上方山体出现连续位移，需重点巡查与限行。'),
  (2, 'BS-HJ-002', '红土崖泥石流沟', '浑江区', '泥石流', 'high', 'alert', 41.945, 126.422, '2026-04-22 11:30:00', '受强降雨影响，沟谷汇流速度加快，存在突发泥石流风险。'),
  (3, 'BS-LJ-003', '鸭绿江岸崩塌点', '临江市', '崩塌', 'medium', 'watch', 41.812, 126.928, '2026-04-21 17:40:00', '岸坡裂隙扩展，局部护坡结构老化。'),
  (4, 'BS-FS-004', '松江河沉陷区', '抚松县', '沉陷', 'high', 'active', 42.332, 127.278, '2026-04-22 09:20:00', '地表沉降速率异常增大，与地下水开采和冻融变化相关。'),
  (5, 'BS-JY-005', '花园口地裂缝带', '靖宇县', '裂缝', 'medium', 'normal', 42.390, 126.808, '2026-04-20 13:45:00', '农田与村道周边出现地裂缝扩展迹象。'),
  (6, 'BS-CB-006', '望天鹅滑塌隐患点', '长白县', '滑塌', 'low', 'normal', 41.419, 128.203, '2026-04-19 10:00:00', '处于常规监测阶段，需保持视频巡检。');

INSERT OR IGNORE INTO sensors (id, site_id, name, sensor_type, unit, status, last_value, last_collected_at) VALUES
  (1, 1, 'JY-位移计-01', '位移', 'mm', 'online', 16.8, '2026-04-23 08:30:00'),
  (2, 1, 'JY-雨量计-01', '雨量', 'mm', 'online', 31.2, '2026-04-23 08:30:00'),
  (3, 2, 'HJ-泥位计-01', '泥位', 'm', 'online', 2.4, '2026-04-23 08:28:00'),
  (4, 2, 'HJ-雨量计-01', '雨量', 'mm', 'online', 28.6, '2026-04-23 08:28:00'),
  (5, 3, 'LJ-裂缝计-01', '裂缝', 'mm', 'online', 4.2, '2026-04-23 08:10:00'),
  (6, 3, 'LJ-倾角仪-01', '倾角', 'deg', 'offline', 1.6, '2026-04-23 06:40:00'),
  (7, 4, 'FS-沉降计-01', '沉降', 'mm', 'online', 12.1, '2026-04-23 08:25:00'),
  (8, 4, 'FS-地下水位-01', '水位', 'm', 'online', 6.4, '2026-04-23 08:25:00'),
  (9, 5, 'JY-裂缝计-02', '裂缝', 'mm', 'online', 3.1, '2026-04-23 08:05:00'),
  (10, 5, 'JY-GNSS-01', '位移', 'mm', 'online', 2.8, '2026-04-23 08:05:00'),
  (11, 6, 'CB-位移计-01', '位移', 'mm', 'online', 1.1, '2026-04-23 08:00:00'),
  (12, 6, 'CB-视频网关-01', '视频', 'fps', 'online', 25.0, '2026-04-23 08:00:00');

INSERT OR IGNORE INTO observations (id, sensor_id, observed_at, value, quality, anomaly_level) VALUES
  (1, 1, '2026-04-22 20:30:00', 14.9, 'A', 'medium'),
  (2, 1, '2026-04-23 02:30:00', 15.8, 'A', 'high'),
  (3, 1, '2026-04-23 08:30:00', 16.8, 'A', 'high'),
  (4, 2, '2026-04-22 20:30:00', 18.4, 'A', 'medium'),
  (5, 2, '2026-04-23 02:30:00', 25.7, 'A', 'high'),
  (6, 2, '2026-04-23 08:30:00', 31.2, 'A', 'high'),
  (7, 3, '2026-04-22 20:28:00', 1.5, 'A', 'medium'),
  (8, 3, '2026-04-23 02:28:00', 2.0, 'A', 'high'),
  (9, 3, '2026-04-23 08:28:00', 2.4, 'A', 'high'),
  (10, 4, '2026-04-22 20:28:00', 16.2, 'A', 'medium'),
  (11, 4, '2026-04-23 02:28:00', 21.4, 'A', 'medium'),
  (12, 4, '2026-04-23 08:28:00', 28.6, 'A', 'high'),
  (13, 5, '2026-04-22 20:10:00', 3.3, 'A', 'low'),
  (14, 5, '2026-04-23 02:10:00', 3.8, 'A', 'medium'),
  (15, 5, '2026-04-23 08:10:00', 4.2, 'A', 'medium'),
  (16, 6, '2026-04-22 18:40:00', 1.2, 'B', 'low'),
  (17, 6, '2026-04-23 00:40:00', 1.4, 'B', 'low'),
  (18, 6, '2026-04-23 06:40:00', 1.6, 'B', 'medium'),
  (19, 7, '2026-04-22 20:25:00', 10.4, 'A', 'medium'),
  (20, 7, '2026-04-23 02:25:00', 11.2, 'A', 'high'),
  (21, 7, '2026-04-23 08:25:00', 12.1, 'A', 'high'),
  (22, 8, '2026-04-22 20:25:00', 5.8, 'A', 'medium'),
  (23, 8, '2026-04-23 02:25:00', 6.1, 'A', 'medium'),
  (24, 8, '2026-04-23 08:25:00', 6.4, 'A', 'medium'),
  (25, 9, '2026-04-22 20:05:00', 2.5, 'A', 'low'),
  (26, 9, '2026-04-23 02:05:00', 2.8, 'A', 'low'),
  (27, 9, '2026-04-23 08:05:00', 3.1, 'A', 'medium'),
  (28, 10, '2026-04-22 20:05:00', 2.1, 'A', 'low'),
  (29, 10, '2026-04-23 02:05:00', 2.5, 'A', 'low'),
  (30, 10, '2026-04-23 08:05:00', 2.8, 'A', 'low'),
  (31, 11, '2026-04-22 20:00:00', 0.6, 'A', 'low'),
  (32, 11, '2026-04-23 02:00:00', 0.8, 'A', 'low'),
  (33, 11, '2026-04-23 08:00:00', 1.1, 'A', 'low'),
  (34, 12, '2026-04-22 20:00:00', 25.0, 'A', 'low'),
  (35, 12, '2026-04-23 02:00:00', 25.0, 'A', 'low'),
  (36, 12, '2026-04-23 08:00:00', 25.0, 'A', 'low');

INSERT OR IGNORE INTO alerts (id, site_id, title, severity, status, source, description, created_at, acknowledged_at, recommended_action) VALUES
  (1, 1, '七道江滑坡位移连续上升', 'critical', 'active', 'AI趋势模型', '近12小时位移累计增幅超过阈值，存在进一步失稳风险。', '2026-04-23 08:35:00', NULL, '立即组织现场核查，划定警戒范围并限制车辆通行。'),
  (2, 2, '红土崖泥石流沟降雨触发预警', 'high', 'active', '传感器联动', '雨量与泥位同步抬升，已达到二级响应条件。', '2026-04-23 07:50:00', NULL, '通知沿沟居民撤离，启动临时避险点。'),
  (3, 4, '松江河沉陷区沉降异常', 'high', 'acknowledged', '时序分析模型', '沉降速率较历史均值偏高 38%，需要复核地下水开采情况。', '2026-04-22 16:20:00', '2026-04-22 16:45:00', '安排专家会商并核查周边施工扰动。'),
  (4, 3, '鸭绿江岸坡崩塌风险提醒', 'medium', 'active', '视频巡检', '视频巡检发现裂隙延展与块体松动。', '2026-04-21 14:10:00', NULL, '增加视频巡检频次，安排护坡设施复查。'),
  (5, 5, '花园口地裂缝带常规关注', 'low', 'acknowledged', '群众上报复核', '群众上报与现场核验一致，建议纳入常规观察。', '2026-04-20 10:15:00', '2026-04-20 11:05:00', '纳入下一轮村道巡检计划。'),
  (6, 6, '望天鹅景区边坡巡检提醒', 'low', 'active', '人工巡查', '景区边坡近期有小范围表层松动迹象。', '2026-04-19 09:30:00', NULL, '维持现有警示标识与视频巡检。');

INSERT OR IGNORE INTO crowd_reports (id, site_id, reporter_name, phone, title, report_type, description, image_url, lat, lng, confidence_score, status, created_at) VALUES
  (1, 1, '王松', '13800000001', '居民区后山出现新裂缝', '滑坡', '裂缝宽度较昨天明显增大，附近有碎石滚落。', NULL, 41.909, 126.581, 0.86, 'pending', '2026-04-23 08:05:00'),
  (2, 2, '李雪', '13800000002', '沟谷水体浑浊且流速加快', '泥石流', '昨晚降雨后看到沟口泥水明显变黄。', NULL, 41.946, 126.421, 0.78, 'verified', '2026-04-22 19:20:00'),
  (3, 5, '赵岩', '13800000003', '村道旁裂缝延长', '裂缝', '裂缝已经延伸到农田边，长度约 7 米。', NULL, 42.391, 126.807, 0.72, 'pending', '2026-04-21 15:12:00'),
  (4, 3, '陈涛', '13800000004', '江岸边坡掉块', '崩塌', '有拳头大小石块坠落到步道边。', NULL, 41.811, 126.929, 0.69, 'reviewing', '2026-04-20 17:45:00'),
  (5, 4, '周敏', '13800000005', '地面沉降导致围栏倾斜', '沉陷', '厂区围栏倾斜加剧，地面存在积水。', NULL, 42.333, 127.279, 0.81, 'verified', '2026-04-19 11:05:00');

INSERT OR IGNORE INTO analysis_models (id, name, category, version, accuracy, status, last_run_at, summary) VALUES
  (1, 'LandslideVision', '滑坡识别', 'v2.1.0', 0.93, 'stable', '2026-04-23 08:00:00', '融合裂缝图像与坡面纹理特征，支持群众图片 AI 初审。'),
  (2, 'DebrisFlow Sentinel', '泥石流预警', 'v1.8.4', 0.91, 'stable', '2026-04-23 07:45:00', '结合雨量、泥位和地形参数进行触发概率预测。'),
  (3, 'Subsidence Prophet', '沉陷分析', 'v1.4.2', 0.88, 'training', '2026-04-22 18:10:00', '使用时序沉降数据和地下水位数据进行趋势外推。'),
  (4, 'Multi-source Fusion Engine', '多源融合', 'v3.0.1', 0.95, 'stable', '2026-04-23 06:30:00', '整合遥感、视频、传感器和群众上报数据，生成统一态势底板。');

INSERT OR IGNORE INTO assessments (id, site_id, level, population_affected, economic_loss, road_impact, summary, created_at) VALUES
  (1, 1, '重大', 126, 380.0, '影响乡道 X214 半幅通行', '若持续降雨，可能影响居民点 38 户及下方乡道。', '2026-04-23 08:40:00'),
  (2, 2, '较大', 84, 210.0, '影响沟口便道与 1 处桥涵', '泥石流沟下游有临时安置点，需提前预警疏散。', '2026-04-23 08:00:00'),
  (3, 4, '较大', 42, 160.0, '工业园区支路受影响', '沉陷区若继续扩大，将影响园区围挡与地下管网。', '2026-04-22 17:10:00'),
  (4, 3, '一般', 12, 35.0, '沿江步道可能临时封闭', '适合通过视频巡检和护坡加固处置。', '2026-04-21 15:00:00');

INSERT OR IGNORE INTO emergency_plans (id, title, level, status, leader, summary, resource_summary, updated_at) VALUES
  (1, '七道江滑坡群紧急转移预案', 'I级', '已启动', '江源区应急指挥部', '包含分区撤离路线、临时安置点启用和夜间巡查安排。', '转移车辆 8 台、编织袋 2000 个、无人机 2 架、专家 3 人', '2026-04-23 08:20:00'),
  (2, '红土崖泥石流沟联防联控方案', 'II级', '待命', '浑江区自然资源局', '以雨量阈值和泥位阈值双触发，联动乡镇和交通部门。', '抢险队伍 2 支、装载机 1 台、卫星电话 4 部', '2026-04-23 07:30:00'),
  (3, '松江河沉陷区综合治理方案', 'III级', '编制中', '抚松县住建局', '围绕地下水开采控制、地表裂缝处置与长期监测布设展开。', '沉降监测点增设 6 处、地质勘探班组 1 支', '2026-04-22 16:50:00');

INSERT OR IGNORE INTO system_logs (id, category, level, message, created_at) VALUES
  (1, 'ingestion', 'info', '传感器网关接收 12 条位移数据并完成入库。', '2026-04-23 08:31:00'),
  (2, 'analysis', 'info', 'LandslideVision 完成群众上报批量初审，新增高可信结果 2 条。', '2026-04-23 08:12:00'),
  (3, 'ingestion', 'error', '临江市倾角仪网关心跳超时，自动切换为离线状态。', '2026-04-23 06:42:00'),
  (4, 'alert', 'warning', '七道江滑坡群风险等级由高调整为极高。', '2026-04-23 08:36:00'),
  (5, 'command', 'info', '红土崖泥石流沟已生成 II 级转移通知单。', '2026-04-23 08:05:00'),
  (6, 'ingestion', 'info', '卫星遥感专题图层完成 04:00 批次同步。', '2026-04-23 05:10:00'),
  (7, 'analysis', 'info', 'Subsidence Prophet 开始执行沉陷趋势再训练任务。', '2026-04-22 18:00:00'),
  (8, 'report', 'info', '群众上报“居民区后山出现新裂缝”进入待审核队列。', '2026-04-23 08:06:00'),
  (9, 'security', 'info', '管理员 admin 成功登录系统。', '2026-04-23 08:50:00'),
  (10, 'report', 'warning', '花园口地裂缝带群众上报已超过常规周均值。', '2026-04-21 15:30:00');

