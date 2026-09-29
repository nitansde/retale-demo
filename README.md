# ReTale · 戏说 Demo

直接运行 ReTale 当前版本的书库、工作台、阅读/编辑器、图谱、改写/续写、What-if、未来跳跃、角色扮演、知识库、设置、预设兼容库、搜索与写作技巧页面。内置中英文两套独立书库：中文六本、英文六本。英文类型小说独立创作，不是中文故事的翻译。

界面和状态管理来自 ReTale 提交 `444fe4c12b4876c29bb77a188e6afbd8a3b4e6f1`。`upstream-manifest.json` 记录原文件哈希；`npm run verify:upstream` 检查复制后的原版代码没有被改动。不是另写一套类似的 UX。

## 样书（2026-09-29）

| 样书 | 类型与开场 | 篇幅 | 建议先点开的分支 |
| --- | --- | --- | --- |
| 退婚当天，我继承了反派宗门 | 退婚、系统、宗门经营：正道先还魔教的债 | 6 章原创 | 如果退婚者当众作证 |
| 重生后，侯府全家能听见我的心声 | 重生、真假千金、读心：拒喝上一世的毒燕窝 | 6 章原创 | 如果现在就拆穿读心 |
| 勇者辞职后，魔王成了我的房东 | 异世界合租：辞职勇者与缺钱魔王 | 6 章原创 | 如果房东主动求助 |
| 全校都以为我们在交往，只有她知道明天会重置 | 校园恋爱与循环：第十七个星期五的情书 | 6 章原创 | 如果他先道歉再求助 |
| 三国演义·赤壁 | 罗贯中原著，从舌战群儒到华容道 | 第43—50回全文 | 如果借箭不瞒周瑜 · 演示 |
| 西游记·大闹天宫 | 传统署名吴承恩，名位与自由之争 | 第4—7回全文 | 如果大圣先问金星 · 演示 |

新书共 36 个章节/回目，约 7 万字（含标点）；其中原创约 8 千字。每本配 5—8 位主要人物、人物关系、世界设定、伏笔/提纲、逐章事件与真实原文证据。每本六个预设分支包含改写、续写、两种 What-if、未来跳跃和角色对话，另有本书写作技巧卡与封面。

《三国演义》《西游记》的正文、回目及引用以简体展示，通过 OpenCC（t → cn）转换字形，保留原著措辞与诗词，未改写成白话文。来源与固定版本链接见 [sources.txt](public/sources.txt)。选篇在工作台内按 1…N 排序，章节标题保留原书回数。后续正文之外的模拟分支均明确标为“演示原创分支，非原著”。

数据版本 5 将两部中文名著及其图谱、分支引用转为简体，并同步转换既有编辑和草稿中的字形；版本 4 移除旧演示《雾城来信》《星海回声》及其分支、技巧卡和浏览器草稿。其余样书编辑、用户导入、设置和删除操作保留；刷新不会重复添加分支。首次升级后手动删除的新书也不会被自动恢复。“重置演示”会恢复完整书库。

## English collection

Use the existing **English** language switch in the library. Six independently authored or public-domain English books replace the Chinese collection in the library and writing-skill sources. Switching back restores the Chinese collection. Both collections stay in the same browser database; changing language never overwrites the book or draft currently open in the workspace. Visitor imports remain visible in either language.

| Book | Genre and opening hook | Contents |
| --- | --- | --- |
| The Last Safe Room | LitRPG / progression fantasy. The tutorial kills its hero; a paramedic gets a class with zero damage and a safe room with one slot too few. | 6 original short chapters |
| A Bargain of Salt and Crows | Romantasy. An assassin arrives at a fae prince’s wedding with a knife and a borrowed name; the crown is hungry for another bride. | 6 original short chapters |
| A Familiar Kind of Murder | Cozy fantasy mystery. A tea-shop owner, a sarcastic raven and a murdered mayor’s ghost who remembers flavours instead of faces. | 6 original short chapters |
| The Saint of Bellwether Hall | Dark academia. A scholarship includes caring for a “body” that wakes up—and wants its stolen brilliance back. | 6 original short chapters |
| Pride and Prejudice | Jane Austen’s social comedy: money, dancing and a first impression that becomes a private grievance. | Complete chapters I–VI |
| Dracula | Bram Stoker’s Gothic journal: a gracious host, no reflection and letters dated in the future. | Complete chapters I–IV |

The four originals use distinct voices: first-person paramedic humour, wary romantic bargaining, a gently comic third-person mystery, and intimate academic horror. These are compact demo episodes, not full-length novels. Each English book has its own cast, relationships, lore, chapter events, graph evidence, writing technique and six seeded branches. English books also use English prompt presets, mock context and roleplay responses. The model remains simulated.

Public-domain text provenance, download checksums and editorial processing are recorded in [sources.txt](public/sources.txt). Original excerpts stay intact; new counterfactual scenes are explicitly labelled. Edition 3 added the English collection. Edition 4 retires the two prototype demos and their associated data while preserving all other books, edits, visitor imports and intentional deletions. “Reset demo” restores both collections and retains the selected UI language.

## 运行

```sh
npm ci
npm run dev
```

访问 http://localhost:3000 。静态演示由 `demo/` 数据适配层和 MSW Service Worker 响应原版页面的 API 请求。编辑、TXT 导入、分支和对话保存在当前浏览器 localStorage；左下角“重置演示”恢复初始数据。原版 TXT 分章、预设导入解析、主题、字体和中英文切换代码均直接复用。

## 演示边界

AI 改写、续写、未来跳跃使用按书编写的模拟结果，默认角色有轮换台词；知识提取、向量检索和写作技巧提炼也使用模拟结果，不调用模型或外部 API。语义搜索使用本地字符匹配模拟结果排序，精确搜索检索当前书内文本。服务端 SQLite、LanceDB 与 HanLP 不运行；保留原数据结构与接口形状。真实数据库、环境配置及密钥不在仓库内。Service Worker 需要 HTTPS 或 localhost。

## GitHub Pages

仓库 Settings → Pages → Build and deployment 选择 **GitHub Actions**。推送 `main` 后工作流会构建并发布 `out/`，路径前缀自动使用仓库名称。URL 为 `https://nitansde.github.io/<仓库名称>/`。

```sh
NEXT_PUBLIC_BASE_PATH=/retale-demo npm run build
```

本地无路径前缀的构建使用 `npm run build`，并用静态 HTTP 服务器在端口 3000 提供 `out/`。刷新 `/workspace/`、`/library/`、`/writing-skills/` 都有对应 HTML 文件。部署无需 Node 服务或数据库。

## 内容维护与验证

- `demo/catalog/webnovels.ts`、`lightnovels.ts`：原创正文、人物、关系、设定及分支。
- `demo/catalog/classics.ts`：名著说明与演示分支；`public-domain.json`：简体公版正文快照，附原始版本链接及转换说明。
- `demo/catalog/english-serials.ts`、`english-mysteries.ts`：独立英文原创；`english-classics.ts`、`english-public-domain.json`：英文名著与演示分支。
- `npm run test:english-ui`：英文六书、真实语言切换、编辑保留、技巧卡与移动端验证。
- `npm run test:catalog`：内容引用、图谱证据、各书生成/跳跃、旧版数据迁移与存储容量。
- `npm test`：原工作台交互回归；`npm run test:collection-ui`：新书入口、分支、角色对话与移动端。
- `scripts/import-public-domain.py`：手动重新获取维基文库原文；网站构建与运行均不依赖该站在线。
- `scripts/create-demo-covers.py`：通过已有封面字段生成 SVG 书封，不修改 ReTale UI。

English source refresh: `python3 scripts/import-english-classics.py`. English SVG covers: `python3 scripts/create-english-covers.py`.
