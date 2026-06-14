# 工时清单微信小程序

个人工时记录与管理的微信小程序，帮助你轻松追踪每日工作时长、休息时间和加班情况。

## 功能特性

- **每日工时记录**：记录上下班时间、休息时长
- **自动计算**：自动计算工作时长、加班时长、工时余额
- **数据统计**：月度汇总、工时趋势分析
- **数据备份**：云端备份与恢复，保护数据安全
- **预设模板**：快速录入常用时间段
- **函数式编程**：模块化设计，易于测试和维护

## 项目结构

```
.
├── pages/              # 页面目录
│   ├── index/         # 首页（数据看板）
│   ├── record/        # 记录页（工时录入）
│   └── profile/       # 设置页（备份导出）
├── utils/             # 工具模块
│   ├── worktime.js    # 核心业务逻辑
│   ├── model.js       # 数据模型
│   ├── calc.js        # 时长计算
│   ├── time.js        # 时间工具
│   ├── report.js      # 数据统计
│   ├── storage.js     # 本地存储
│   └── remoteBackup.js # 云端备份
├── tests/             # 测试文件
└── package.json       # 依赖配置
```

## 技术栈

- **UI 组件库**：Vant Weapp 1.11.7
- **存储方案**：微信本地存储（wx.storage）
- **编程范式**：函数式编程，纯函数设计
- **测试方案**：Node.js 原生测试
- **代码风格**：ESLint 规范

## 开发指南

### 环境准备

1. 安装微信开发者工具
2. 安装 Node.js (建议 v14+)
3. 克隆项目并安装依赖：

```bash
npm install
```

### 配置项目

1. 复制配置模板：
```bash
cp project.config.sample.json project.config.json
```

2. 在 `project.config.json` 中填入你的 `appid`

### 构建依赖

在微信开发者工具中：
1. 点击「工具」→「构建 npm」
2. 构建完成后会生成 `miniprogram_npm` 目录

### 运行测试

```bash
npm test
```

### 代码检查

```bash
# 检查代码风格
npm run lint

# 自动修复
npm run lint:fix
```

## 数据模型

### Store 结构

```javascript
{
  version: 4,              // 数据版本号
  months: {                // 按月组织的数据
    '2025-01': {
      entries: {           // 每日记录
        '2025-01-15': {
          start: '09:00',
          end: '18:00',
          breakMinutes: 60,
          note: '正常工作日'
        }
      }
    }
  },
  settings: {              // 用户设置
    standardMinutes: 480,  // 标准工时（分钟）
    presets: [],           // 快捷预设
    monthlyBalance: {}     // 月度余额
  }
}
```

### 备份格式

备份文件格式版本：v4

```javascript
{
  format: 'worktime-miniapp-backup',
  version: 4,
  fileName: 'backup-260610-162205.json',
  exportedAt: '2025-01-15T10:30:00.000Z',
  client: {
    device: {},
    os: {},
    wechat: {},
    miniProgram: {}
  },
  store: { /* Store 数据 */ }
}
```

## 核心模块

### worktime.js

聚合所有业务逻辑的主入口，包含：
- 数据模型规范化
- 默认值处理
- 预设管理

### calc.js

时间计算引擎：
- 工作时长计算（扣除休息）
- 加班时长计算
- 月度汇总统计

### storage.js

数据持久化：
- 基于 wx.storage 的同步读写
- 数据备份序列化与解析
- 错误处理和日志

## 测试覆盖

- `worktime.test.js` - 核心业务逻辑
- `record-page.test.js` - 记录页逻辑
- `profile-page.test.js` - 设置页逻辑
- `backup-export.test.js` - 备份序列化
- `remote-backup.test.js` - 云端备份
- `performance.test.js` - 性能测试
- `system-info-compat.test.js` - 兼容性测试

## 最佳实践

1. **函数式设计**：所有工具函数都是纯函数，避免副作用
2. **不可变数据**：使用 `Object.assign` 和展开运算符创建新对象
3. **错误处理**：存储操作都包含 try-catch，防止数据丢失
4. **向后兼容**：保留旧版本数据迁移逻辑
5. **测试先行**：新功能都应该先写测试

## 部署发布

1. 确保所有测试通过
2. 运行代码检查
3. 在微信开发者工具中点击「上传」
4. 在微信公众平台提交审核

## 常见问题

**Q: miniprogram_npm 文件夹为什么不提交到 git？**

A: 这是构建产物，应该在开发者工具中重新构建，不应跟踪到版本控制。

**Q: 为什么使用同步存储 API？**

A: 小程序页面生命周期主要是同步的，使用同步 API 更简单可靠。

**Q: 如何迁移旧版本数据？**

A: 数据加载时会自动检测版本号并进行迁移，用户无感知。

## 贡献指南

欢迎提交 Issue 和 Pull Request！

## 许可证

MIT License

## 联系方式

如有问题或建议，欢迎通过 Issue 反馈。
