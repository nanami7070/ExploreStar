# 探知星 ExploreStar

面向小学科学探究学习的智能助教原型 —— 毕业论文《面向小学科学探究学习的智能助教原型设计与开发》的配套实现。

本项目基于开源项目 [OpenMAIC](https://github.com/THU-MAIC/OpenMAIC)（MIT License）二次开发，把通用的 AI 课堂平台特化为一条面向小学生的科学探究主线：**学生自主提问 → AI 生成可探究方案 → 六阶段探究 → 学习报告 → 教师审核**。

> 部署步骤见 **[老师部署指南.md](老师部署指南.md)**。密钥只放在 `.env.local`（已加入 `.gitignore`），不要提交。

## 功能概览

### 学生端 `/inquiry`

- **自主提问**：从学生自己的问题出发，AI 理解意图，必要时先追问澄清。
- **方案生成与修改**：生成包含六步探究地图、材料清单与实验安全提醒的探究方案；可与导师讨论后重新生成，保留版本历史。
- **六阶段探究工作台**：提出问题 → 猜想与假设 → 设计实验 → 收集证据 → 分析结果 → 反思与修正。
- **阶段化支架**：每个阶段提供引导问题与提示，导师以启发为主，不直接给出答案。
- **两种实验形态**：面向课堂演示的沉浮模拟实验；面向真实观察任务的记录台（先猜一猜 / 我观察到了什么 / 补充说明）。
- **学习报告**：规则评价 + 模型语义评价，生成六维「科学家本领」与下一步学习建议。
- **预设探究任务**：内置示例任务，也支持学生自主创建的探究。

### 教师端 `/teacher`

- 口令登录（由环境变量 `INQUIRY_TEACHER_TOKEN` 配置，未配置时教师端整体关闭）。
- 学生探究记录总览与状态筛选。
- 学生原始记录查看：六阶段记录、实验/观察记录、导师对话。
- 学习报告审核、探究任务审核。

## 技术栈

- Next.js 16（App Router）+ React 19 + TypeScript
- PostgreSQL 服务端持久化（首次使用时自动建表/迁移）
- pnpm 10 / Node.js >= 22.19
- Vitest（单元与集成测试）、Playwright（端到端测试）
- 模型接入沿用 OpenMAIC 的模型槽位：探究导师使用 `classroom.inquiry`，语义评价使用 `classroom.inquiry.evaluation`，二者默认继承 `classroom` → `llm`。

## 目录结构

```
app/inquiry/            学生端页面（首页 / 新探究 / 任务介绍 / 探究工作台）
app/teacher/            教师端页面（工作台 / 学生详情）
app/api/inquiry/        探究与教师 API 路由
components/inquiry/     探究界面组件与主题样式
lib/inquiry/            领域模型、阶段状态机、方案生成、安全、评价、实验
lib/persistence/        持久化与新表结构（inquiry-tables.ts）
tests/inquiry/          探究模块单元/集成测试
e2e/tests/inquiry-flow.spec.ts   Playwright 端到端流程
其余 app/ components/ lib/ 等目录为 OpenMAIC 上游平台代码
```

## 许可与致谢

- 本项目以 MIT License 发布，详见 [LICENSE](LICENSE)。
- 原项目 OpenMAIC © 2026 THU-MAIC。
- 二次开发部分 © 2026 探知星 ExploreStar 项目。
