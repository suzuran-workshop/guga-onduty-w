# 校园值周管理

面向中小学的值周评分管理平台——值周生记录班级表现、系统自动统计排名、班主任申诉、流动红旗颁发。

## 这是什么？
- **定位**：校内值周工作的数字化工具，替代纸质打分表
- **解决的核心问题**：值周打分靠纸笔易丢失难统计、跨周汇总手工算、申诉无流程追踪、多校区数据割裂

## 为什么存在？
- 传统值周打分依赖纸质表格，数据分散在各值周生手里
- 每周汇总排名耗时且容易出错
- 班主任对扣分有异议时缺乏规范申诉通道
- 数字大屏是校园信息化展示的刚需

## 如何安装和运行？
- **前置要求**：Node.js >= 22、pnpm
- **安装步骤**：
  ```bash
  pnpm install
  pnpm db:seed          # 初始化数据库和测试数据
  ```
- **启动（开发模式）**：
  ```bash
  pnpm dev:server       # 后端 http://localhost:3000
  pnpm dev:web          # 前端 http://localhost:5173
  ```
- 测试账号：admin / teacher1 / student1，密码均为 `123456`

## 当前状态
- **阶段**：原型
- **已知限制**：通知仅做数据记录未对接推送通道；图片不支持缩略图查看

## 核心技术
- **后端**：Hono + @hono/node-server + node:sqlite (DatabaseSync)
- **前端**：React 18 + Fluent UI v9 + react-router + i18next
- **类型共享**：pnpm workspace (apps/server + apps/web + packages/shared)
- **认证**：JWT (jsonwebtoken)
- **实时**：SSE (Server-Sent Events)