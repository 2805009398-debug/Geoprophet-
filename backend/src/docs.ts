export const requirementsSummary = [
  {
    area: '地灾监测数据接收与管理',
    implemented: [
      '监测点、传感器、原始观测值管理',
      '数据接收状态与错误日志可视化',
      '数据查询、检索、权限登录与操作日志基础能力'
    ]
  },
  {
    area: '地灾灾情监测与分析',
    implemented: [
      '算法模型库展示',
      '灾情影响评估结果管理',
      '预警信息汇总与研判看板'
    ]
  },
  {
    area: '地灾监测综合可视化',
    implemented: [
      '白山市监测点地图态势',
      '预警趋势与经济影响图表',
      '应急预案、资源调度与群众上报联动'
    ]
  }
];

export const apiCatalog = {
  openapi: '3.0.3',
  info: {
    title: 'GeoProphet REST API',
    version: '0.1.0',
    description: '面向 GeoProphet Web 版监测、预警、研判和群众上报场景的示例接口。'
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
    '/api/dashboard/overview': { get: { summary: '获取总览统计、预警趋势和地图态势' } },
    '/api/sites': { get: { summary: '监测点位列表' } },
    '/api/sites/{id}': { get: { summary: '监测点位详情' } },
    '/api/alerts': { get: { summary: '预警列表' }, post: { summary: '新增预警' } },
    '/api/alerts/{id}/ack': { patch: { summary: '确认预警' } },
    '/api/reports': { get: { summary: '群众上报列表' }, post: { summary: '提交群众上报' } },
    '/api/uploads': { post: { summary: '上传图片附件' } },
    '/api/analysis/models': { get: { summary: '算法模型库' } },
    '/api/analysis/assessments': { get: { summary: '灾情影响评估结果' } },
    '/api/analysis/runs': { get: { summary: '最近识别任务记录' } },
    '/api/analysis/landslide': { post: { summary: '滑坡图片识别与区域标注' } },
    '/api/analysis/glacier': { post: { summary: 'InSAR 冰川识别与变化区域标注' } },
    '/api/plans': { get: { summary: '应急处置预案列表' } }
  }
};
