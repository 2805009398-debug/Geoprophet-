export const requirementsSummary = [
  {
    area: '群众线索补充',
    implemented: [
      '公开提交页支持免登录提交现场照片、位置和描述',
      '后台群众举证表单支持补录、图片上传和关联点位',
      '线索队列按状态、类型、置信度和提交时间留痕'
    ]
  },
  {
    area: 'YOLO / 豆包图像初筛',
    implemented: [
      '上传航拍图、无人机照片、现场巡查图片或移动端照片',
      '可调用本地模型服务或豆包视觉模型进行疑似地灾初步识别',
      '返回疑似区域、风险分数、判定依据和复核建议'
    ]
  },
  {
    area: '后台复核支撑',
    implemented: [
      '线索总览展示待复核、带图举证和近 7 日提交趋势',
      '识别记录留存源文件、模型、置信度和摘要',
      '本地账号登录、OIDC 配置占位和审计日志基础能力'
    ]
  }
];

export const apiCatalog = {
  openapi: '3.0.3',
  info: {
    title: 'GeoProphet REST API',
    version: '0.1.0',
    description: '面向群众线索补充、YOLO 航拍图像初筛和后台复核场景的示例接口。'
  },
  servers: [
    {
      url: 'http://localhost:3000',
      description: 'Local API server'
    }
  ],
  paths: {
    '/api/auth/login': { post: { summary: '账号密码登录' } },
    '/api/auth/providers': { get: { summary: '获取登录方式与演示账号' } },
    '/api/dashboard/overview': { get: { summary: '获取线索总览、提交趋势和参考预警' } },
    '/api/sites': { get: { summary: '监测点位列表' } },
    '/api/sites/{id}': { get: { summary: '监测点位详情' } },
    '/api/alerts': { get: { summary: '预警列表' }, post: { summary: '新增预警' } },
    '/api/alerts/{id}/ack': { patch: { summary: '确认预警' } },
    '/api/reports': { get: { summary: '群众上报列表' }, post: { summary: '提交群众上报' } },
    '/api/uploads': { post: { summary: '上传图片附件' } },
    '/api/system/vision-config': { get: { summary: '获取视觉大模型配置状态，不返回 API Key' } },
    '/api/analysis/models': { get: { summary: '算法模型库' } },
    '/api/analysis/assessments': { get: { summary: '灾情影响评估结果' } },
    '/api/analysis/runs': { get: { summary: '最近识别任务记录' } },
    '/api/analysis/landslide': { post: { summary: 'YOLO 航拍图像滑坡初筛与区域标注' } },
    '/api/analysis/mobile-image': { post: { summary: '豆包视觉移动端图片地灾初筛' } }
  }
};
