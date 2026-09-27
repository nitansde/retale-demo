# ReTale · 戏说 Demo

直接运行 ReTale 当前版本的书库、工作台、阅读/编辑器、图谱、改写/续写、What-if、未来跳跃、角色扮演、知识库、设置、预设兼容库、搜索与写作技巧页面。内置两本原创虚构小说及所有分支类型的示例数据。

界面和状态管理来自 ReTale 提交 `444fe4c12b4876c29bb77a188e6afbd8a3b4e6f1`。`upstream-manifest.json` 记录原文件哈希；`npm run verify:upstream` 检查复制后的原版代码没有被改动。不是另写一套类似的 UX。

## 运行

```sh
npm ci
npm run dev
```

访问 http://localhost:3000 。静态演示由 `demo/` 数据适配层和 MSW Service Worker 响应原版页面的 API 请求。编辑、TXT 导入、分支和对话保存在当前浏览器 localStorage；左下角“重置演示”恢复初始数据。原版 TXT 分章、预设导入解析、主题、字体和中英文切换代码均直接复用。

## 演示边界

AI 改写、续写、角色回复、未来跳跃、知识提取、向量检索和写作技巧提炼使用固定模拟结果，不调用模型或外部 API。语义搜索使用本地字符匹配模拟结果排序，精确搜索检索当前书内文本。服务端 SQLite、LanceDB 与 HanLP 不运行；保留原数据结构与接口形状。真实数据库、环境配置及密钥不在仓库内。Service Worker 需要 HTTPS 或 localhost。

## GitHub Pages

仓库 Settings → Pages → Build and deployment 选择 **GitHub Actions**。推送 `main` 后工作流会构建并发布 `out/`，路径前缀自动使用仓库名称。URL 为 `https://nitansde.github.io/<仓库名称>/`。

```sh
NEXT_PUBLIC_BASE_PATH=/retale-demo npm run build
```

本地无路径前缀的构建使用 `npm run build`，并用静态 HTTP 服务器在端口 3000 提供 `out/`。刷新 `/workspace/`、`/library/`、`/writing-skills/` 都有对应 HTML 文件。部署无需 Node 服务或数据库。
