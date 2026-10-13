# 【FSU】EA FC FUT Web 增强器 — 需求规格说明书

> **本文档由源码反推生成，不是原始设计文档。**

| 项 | 值 |
|---|---|
| 反推对象 | `fsu.js` v27.00（迁移自 26.09，见 `MIGRATION-FC27.md`） |
| 代码规模 | 15,764 行 / 869 KB，单一 IIFE |
| 反推日期 | 2026-10-13 |
| 原作者 | Futcd_kcka（`https://futcd.com/`，MIT） |

## 0. 文档说明

### 0.1 反推方法与可信度

| 素材 | 来源 | 可信度 |
|---|---|---|
| 功能名称与用户可见描述 | 脚本内置 i18n 表 `info.localization`（495 条，`fsu.js:1137-1642`） | **高** —— 作者原话 |
| 配置项清单 | `info.setfield` + `set.*` i18n（`fsu.js:86`、50 条标签） | **高** |
| 触发点（挂载位置） | 106 处 `*.prototype.*` 覆写 + 作者行内注释 | **高** |
| 外部数据契约 | 12 个 FSU 配置接口 + 7 类第三方端点的实际解析代码 | **中** —— 只能反推出被消费的字段 |
| 业务规则细节（算法、阈值） | 实现代码 | **中** —— 实现即规格，无法区分"有意设计"与"将就" |
| 设计意图、优先级、验收标准 | 无素材 | **缺失** —— 本文档不含此部分 |

标注约定：**[显式]** 代码或 i18n 明确表达；**[反推]** 由实现推断；**[待确认]** 需要作者或实测确认。

### 0.2 复现本文档的工具

```
tools/extract-i18n.js    # 导出 i18n 表（功能名 + 描述），可加命名空间参数
tools/extract-hooks.js   # 导出 prototype 覆写点 → 作者注释 映射
tools/gen-audit.js       # 导出全部外部依赖符号，生成运行时体检脚本
```

---

## 1. 产品概述

### 1.1 定位 [显式]

EA SPORTS FC Ultimate Team **网页版（Web App）**的浏览器用户脚本增强器。核心价值主张（@description）：
SBC 任务便捷操作、模拟开包、额外信息展示、近期低价自动查询、一键挂出球员、跳转 FUTBIN、快捷搜索、拍卖行优化。

本质是**在 EA 官方 Web App 的 UI 上叠加一层信息展示与批量操作**，自身不托管游戏数据，价格与元数据全部来自第三方站点。

### 1.2 运行环境 [显式]

| 项 | 要求 |
|---|---|
| 宿主 | Tampermonkey 类用户脚本管理器 |
| 注入时机 | `@run-at document-end`，`main()` 按 URL 分流（`fsu.js:15753`） |
| 生效站点 | `ea.com` / `easports.com` 的 `ultimate-team/web-app/*` |
| 已声明未启用 | `easysbc.io/evolutions*`、`futbin.com/*`、`fut.gg/*`（`futgg()` 分支被注释，`fsu.js:15759`） |
| 依赖库 | lodash 4.17.21（`@require`，双 CDN 冗余）+ 一个自定义 mixin `multicombinations`（`fsu.js:59`） |
| 所需权限 | `GM_addStyle`、`GM_openInTab`、`GM_xmlhttpRequest`、`GM_getValue`、`GM_setValue`、`@connect *` |
| 平台适配 | 全功能需区分 PC / 手机端，由 `isPhone()` 分支（影响布局、默认值、按钮文案） |

### 1.3 目标用户 [反推]

FUT 模式重度玩家，核心诉求是**降低 SBC（阵容建设挑战）的操作成本和决策成本**：
需要知道"这个 SBC 值不值得做"（造价 vs 奖励价值）、"我库里能不能做"（需求球员统计）、"怎么填最省"（方案导入、重复球员优先），以及批量执行（一键填充、快速完成、批量挂牌）。

---

## 2. 架构性需求

这部分是从实现反推的架构约束，决定了功能如何挂载。改动时必须遵守。

### AR-1 UI 扩展机制：原型覆写 [显式]

所有界面增强通过覆写 EA Web App 内部类的原型方法实现，统一模式：

```js
const UTXxxView_render = UTXxxView.prototype.render;   // 或存入 call.* 命名空间
UTXxxView.prototype.render = function (...args) {
    UTXxxView_render.call(this, ...args);              // 必须先调用原方法
    /* 增强逻辑 */
};
```

- 共 **106 处**覆写，覆盖 `UT*`（界面/控制器/实体/服务）、`EA*`（基类）、`FC*`（赛季目标）三族
- 原方法引用集中存放在 `call.view` / `call.task` / `call.plist` / `call.panel` / `call.search` / `call.squad` / `call.other` / `call.selectClub` 等命名空间
- 另有 2 处底层拦截：`XMLHttpRequest.prototype.open`（`fsu.js:15491`，抓 meta 数据与 UTAS 域名）、`EALocalizationService.prototype.localize`（`fsu.js:11689`，修 EA 自身的秒数显示 bug）

**约束**：此机制对 EA 前端重构零容错。EA 改类名或方法名，对应功能静默失效或抛异常。

### AR-2 初始化时序 [显式]

`events.init()`（`fsu.js:282`）在首页 HubView 生成后调用（`fsu.js:6843`/`6861`），且带结构就绪判断。顺序：

1. 本地配置载入：`SBCCount.init` → `set.init` → `build.init` → `lock.init` → `futbinId.init`
2. 读取 EA 会话态：`services.Authentication.utasSession.id`、`APP_YEAR_SHORT`、平台（主机判定为 `ps`）、本地化词表
3. 顶部导航注入（SBC 快捷入口容器、SBC 计数）
4. 搜索历史按当前 `UTSearchCriteriaDTO` 字段数做兼容过滤（**[显式]** 跨赛季字段变更的防御）
5. 拉远端配置（见 DR-1），再按需拉 11 个子配置
6. `services.User.maxAllowedAuctions = 100`（**[反推]** 抬高批量挂牌上限）
7. 预取 SBC 套装、商店包列表、目标分类（避免后续功能首次使用卡死）

### AR-3 国际化 [显式]

- 三语：`0=简体`、`1=繁体`、`2=English`，默认 `info.language=2`，由 EA 的 locale 自动判定（`fsu.js:2145`）
- `fy(key)` 查自有词表，支持 `%1` 位置参数、`{key}` 内嵌替换、数组形式传参
- `eafy(key)` 查 EA 自身词表（`services.Localization.repository._collection`）
- **缺口 [待确认]**：`info.setfield` 中的 `sbc_meetsreq` 在 i18n 表里无对应 `set.sbc.meetsreq` 标签，设置页会显示原始键名

### AR-4 配置与持久化 [显式]

所有写入都经 `set.save` / `build.set` / `lock.save` 统一落 GM storage，保存后弹"设置保存成功"。
存储键清单见 DR-2。

### AR-5 资源释放 [显式]

26.04 引入统一销毁机制：覆写 `EAViewController.dealloc`、`EATargetActionView.dealloc`、`UTPlayerItemView.dealloc`，
调用 `events.fsuDispose`（`fsu.js:13925`）回收注入的 DOM 与事件，并维护 `info.keyEvent` 元素注册表。

---

## 3. 功能需求

### FR-1 框架与全局入口

| ID | 功能 | 说明 | 触发点 | 开关 |
|---|---|---|---|---|
| FR-1.1 | 加载成功提示 | 登录页插入已加载标识；主界面通知"FSU插件加载成功" | `UTLoginView._generate` | — |
| FR-1.2 | 顶部说明/升级链接 | 顶部插入文档链接；检测到新版改为"有新版FSU插件可升级" | `events.init` onload | — |
| FR-1.3 | 首页功能 tile | 三个入口：插件配置、重载数据、插件讨论 | `UTHomeHubView._generate` | — |
| FR-1.4 | 设置页 | 独立 ViewController（`fsuSC`/`fsuSV`），按 `info.setfield` 自动生成开关分组 | 首页 tile 进入 | — |
| FR-1.5 | 通知机制 | 统一走 `services.Notification.queue`，44 条预置文案，三级（0 成功/1 提示/2 错误） | `events.notice` | — |
| FR-1.6 | 可中断加载遮罩 | 长任务显示进度文案，点击文案可中止（批量挂牌、方案读取、批量开包等） | `events.showLoader` / `addLoadingElment` | — |
| FR-1.7 | 重载数据 | 清空球员缓存并重新拉取俱乐部统计 | `events.reloadPlayers` | — |

### FR-2 球员卡信息增强

统一挂载在 `UTPlayerItemView.renderItem`（`fsu.js:2354`，单函数约 780 行，是本模块主体）。

| ID | 功能 | 说明 | 开关 |
|---|---|---|---|
| FR-2.1 | 额外位置 | 卡面显示球员可打的其他位置 | `card_pos` |
| FR-2.2 | 球员价格 | 卡面显示当前市场价 | `card_price` |
| FR-2.3 | 其他属性 | 体型（10 类，含"独特体型"）、真实脸/虚拟脸、加速类型（爆发/掌控/漫长） | `card_other` |
| FR-2.4 | 俱乐部内球员 | 标识"已拥有/未拥有"，队内可交易/不可交易/可发送俱乐部 | `card_club` |
| FR-2.5 | 评分低价 | 显示该评分段的市场低价（来自 `lowprice.json`） | `card_low` |
| FR-2.6 | 元评分与排名 | GGRating 分数 + S/A/B/C/D 评级 + 位置，带 ↑↓ 对比球员评分 | `card_meta` |
| FR-2.7 | 卡片样式 | 二选一：随品质变化 / 纯色样式 | `card_style`（1/2） |
| FR-2.8 | 特殊品质标识 | 动态升级（显示剩余天数）、默契提升（显示额外默契来源与数值） | — |
| FR-2.9 | 珍贵球员标识 | 高价球员红色价格标记，提交阵容时二次确认 | — |
| FR-2.10 | 可进化标识 | 卡面标注该球员可进化 | — |
| FR-2.11 | 加速类型弹窗 | 点击加速标识弹出满默契下的加速类型，及可改变加速的默契风格列表 | — |
| FR-2.12 | 道具卡信息 | 非球员物品（组合包等）的信息增强，挂 `UTMiscItemView.renderItem` | — |

**边界 [显式]**：加速类型依赖球员子属性，未载入时标 `*` 并提示"存在偏差"，可点击载入后矫正。

### FR-3 价格体系

| ID | 功能 | 说明 |
|---|---|---|
| FR-3.1 | 价格源三路自动切换 | `info.apiPlatform`：`1`=fut.gg 直连、`2`=fut.gg 自建转发、`3`=futnext。启动时试探 fut.gg 可用性决定（`fsu.js:2163`） |
| FR-3.2 | 批量价格查询 | `events.getPriceForUrl` 批量取价，返回 `{价格, 类型}`，类型区分：普通/SBC 专属/目标专属/赛季通行证 |
| FR-3.3 | FUTBIN 单球员价格 | 按 FUTBIN 球员 ID 查，需先用姓名/筛选反查 ID 并缓存（`futbinId` 命名空间） |
| FR-3.4 | 评分低价表 | 按平台（pc/ps）加载各评分段低价，用于造价预估与欠缺价格计算 |
| FR-3.5 | 转会市场实价捕获 | 挂 `UTTransferMarketPaginationViewModel.startAuctionUpdates`，拦截 EA 自己的市场分页数据，把真实成交均价存入 `info.roster.ea` |
| FR-3.6 | 拍卖低价查询 | 直连 EA UTAS 查指定球员的在售最低价，支持配置查询次数（默认 5 次，见 FR-6.2） |
| FR-3.7 | 价格缓存 | GGRating 缓存 7 天 TTL；FUTBIN ID 映射长期缓存 |

**[待确认]** `card_meta` 相关的 fut.gg meta 分支在 `fsu.js:2667`、`4414` 两处被 `&& false` 硬关闭，功能实际走的是 `playermeta.json` 路径。意图不明。

### FR-4 SBC 增强（最大模块）

| ID | 功能 | 说明 | 触发点 | 开关 |
|---|---|---|---|---|
| FR-4.1 | 导航分类计数 | SBC 导航题头显示各类别数量，已完成类别不显示 | `UTSBCHubView.populateNavigation` | `info_sbc` |
| FR-4.2 | 任务 tile 额外信息 | 造价预估、阵容价值、"值得做/不值得" | `UTSBCHubView.populateTiles` | `info_sbc` |
| FR-4.3 | 子任务信息 | 子任务列表显示造价、奖励价值（算不出时标"无法计算"） | `UTSBCChallengesViewController.viewDidAppear` | `info_sbcs` |
| FR-4.4 | SBC 筛选 | 四类：全部 / 新增 / 临期 / 高评价 | `UTSBCSetsViewModel.getCategories` | `info_sbcf` |
| FR-4.5 | 顶部快捷入口 | 顶部导航常驻 SBC 入口，数量可配（PC 默认 5、手机 3、上限 8）；完成后自动移除 | `events.SBCListInsertToFront` | `sbc_headentrance` |
| FR-4.6 | 需求展示增强 | 需求条件转文本、需求处加"快速完成"按钮 | `UTSBCRequirementsView.render` | — |
| FR-4.7 | 抄作业 | 导入 FUTBIN / FUT.GG 的 SBC 方案 ID 或网址；留空则取 FUTBIN 最低价前 5 方案比价 | `events.getFutbinSbcSquad` | `sbc_template` |
| FR-4.8 | 算评分 | 模拟阵容补全，输出补全后评分与预估球员价值；可跳转网站自由计算 | `events.squadCount` | `sbc_squadcmpl` |
| FR-4.9 | 需求球员统计 | 按评分维度统计：需求 / 已有 / 欠缺 / 欠缺价格，支持导出 txt | `events.sbcListNeedCount` | — |
| FR-4.10 | 提交拦截 | 自动把阵容内可交易球员换成未分配的不可交易同款；发现珍贵球员则二次确认 | `UTSBCSquadOverviewViewController._submitChallenge` | — |
| FR-4.11 | SBC 计数与风控 | 统计当日提交数（按天重置），提示"1 小时内超 90 个可能被禁止提交" | `UTSBCService.submitChallenge` | — |
| FR-4.12 | 快速 SBC | 一键执行指定 SBC：优先未分配球员、应用排除选项、自动提交。首次使用强制风险确认 | `events.fastSBC` | `sbc_autofill` |
| FR-4.13 | 快捷任务 | 收藏常做 SBC 到快速任务 TAB | `events.fastSBCQuantity` | — |
| FR-4.14 | 阵容回退 | 撤销上一次阵容操作，提示剩余可回退次数 | `events.saveOldSquad` | `sbc_sback` |
| FR-4.15 | 商店快速 SBC | 商店页直接重复上次 SBC，无需返回 | `UTStoreViewController.setCategory` | `info_sbcagain` |

**快速 SBC 失败分类 [显式]**：无次数 / 需完成关联任务重置 / 满足条件球员不足 / 交换可交易球员失败 / 疑似被 BAN SBC。

### FR-5 阵容填充与补全

| ID | 功能 | 说明 | 开关 |
|---|---|---|---|
| FR-5.1 | 一键填充（优先重复） | 自动填满阵容，优先使用重复球员 | `sbc_autofill` |
| FR-5.2 | 重复球员填充 | 仅用重复球员填充；填不满时提示原因（在阵容中或被屏蔽条件排除） | `sbc_dupfill` |
| FR-5.3 | 阵容补全 | 假想球员换同评分真球员、空位按输入评分填充（逗号分隔，单值填所有空位） | `sbc_squadcmpl` |
| FR-5.4 | 默契球员名单 | 列出满足当前默契需求的俱乐部球员 | — |
| FR-5.5 | 指定条件球员名单 | 按 SBC 条件列出候选球员 | — |
| FR-5.6 | 排除球员配置 | 排除指定联赛 / 仅不可交易 / 忽略位置 / 排除进化球员 / 挑选严格普通稀有 / 优先仓库球员 / 可使用特殊球员 / 银铜优先普通 / 补全优先非特殊 / 补全黄金范围内优先稀有 | `build.*` |
| FR-5.7 | 快捷添加·替换球员 | 沿用上次搜索配置直接找人；替换源分 7 类：未分配/同评分/默契/满需求/同俱乐部/同地区联赛/假想 | `sbc_quick` |
| FR-5.8 | 假想球员购买 | 直接购买假想球员位，支持批量；可自动分配到阵容 | `sbc_conceptbuy` / `sbc_cback` |
| FR-5.9 | 阵容方案保存 | 保存当前阵容方案 | — |
| FR-5.10 | 选项记录 | 记住上次填充选项 | `sbc_records` |
| FR-5.11 | 搜索球员数量显示 | 筛选器显示命中数量 | `sbc_icount` |

**关键算法 [反推]**
- 默契计算：`events.calculateChemistry` + `getChemistryPointsByThreshold`，自带化学风格加成表（`info.chemstyle`，键 250-273）
- 候选组合：`events.generateCandidateOptions` + lodash mixin `multicombinations` 做排列组合
- 黄金球员范围：默认 ≤83 可配（76-99），影响品质分段与批量开包的仓库分配阈值
- 阵型位置映射：`info.formation` 硬编码 30 个阵型

### FR-6 拍卖行与交易

| ID | 功能 | 说明 | 开关 |
|---|---|---|---|
| FR-6.1 | 批量挂牌 | 勾选列表球员批量上架，显示预估总价与预计耗时，过程可中断；挂牌时长可配（1/3/6/12/24/72 小时） | `player_loas` |
| FR-6.2 | 按低价快速拍卖 | 以查到的最低在售价作为即买价挂出；查询次数可配（默认 5，最低 1） | `player_auction` |
| FR-6.3 | 拍卖搜索优化 | 假想球员搜索自动填好参数；评分范围输入；假想搜索无评分范围时提示 | `sbc_market` |
| FR-6.4 | 搜索历史 | 记录转会搜索条件，可快速复用 | — |
| FR-6.5 | 列表筛选排序 | 五维筛选：评分/范围（仓库·俱乐部）/位置/默契/品质（普通·特殊），升降序 | — |
| FR-6.6 | 未分配批量操作 | 直接发送 N 个至俱乐部；与队内可交易球员批量交换；重复无法发送时报数 | `player_uatoclub` / `player_swapt` |
| FR-6.7 | 转会发送俱乐部 | 转会列表批量发送 | `player_transfertoclub` |
| FR-6.8 | 拍卖行上限提示 | 达到上限时通知；手机端提示需重进清单才刷新 | — |
| FR-6.9 | 前往 FUTBIN | 球员跳转 FUTBIN 页 | `player_futbin` |

### FR-7 开包

| ID | 功能 | 说明 | 开关 |
|---|---|---|---|
| FR-7.1 | 批量开包 | 指定数量批量开；非重复入俱乐部，重复且高于黄金范围入 SBC 仓库，无法分配则停止并弹未分配列表 | — |
| FR-7.2 | 开包结果弹窗 | 汇总：开启数/未开启/入俱乐部/入仓库/特别球员数/最高评分；最多展示 20 人（优先特殊与高评分） | — |
| FR-7.3 | 跳过开包动画 | 覆写 `UTPackAnimationViewController.runAnimation` | `info_skipanimation` |
| FR-7.4 | 模拟开包 | 按 EA 公示概率本地模拟，展示获得球员、本次价值、对比预期回报。**不与 EA 交互** | — |
| FR-7.5 | 真实概率 | 拉 FUTNEXT 的真实开包统计，与 EA 公示概率对比展示 | — |
| FR-7.6 | 包内球员预览 | 展示包内可开球员池（不含常驻低概率传奇和英雄） | `info_pack` |
| FR-7.7 | 特殊品质页 | 列出可动态升级或默契提升的品质 | — |
| FR-7.8 | 挑选包预览 | 挑选包/固定挑选包的候选预览 | — |
| FR-7.9 | 商店快速开包 | 商店页重复上次开包 | `info_packagain` |
| FR-7.10 | 商店信息增强 | 商店总价值、组合包数量角标、按包回报价值排序 | — |

### FR-8 进化（Academy）

| ID | 功能 | 说明 |
|---|---|---|
| FR-8.1 | 任务排序与标识 | 按到期时间排序；新任务/临期标识；首页 tile 显示新增进化数 |
| FR-8.2 | 分类计数 | 进化分类 TAB 显示新任务数量 |
| FR-8.3 | 免费进化标识 | 标出免费进化任务 |
| FR-8.4 | 属性提升预览 | 进化后属性变化：总评/特技/金特技/逆足/花式/位置/角色/稀有度/装饰，主属性与子属性分列 |
| FR-8.5 | EA 计算纠错 | 覆写 `UTItemAcademyStatEntity.getAttributeOverride` / `getSubAttributeOverride`，修 EA 自身的属性计算错误 |
| FR-8.6 | 右侧筛选修复 | 修 EA 进化界面右侧筛选失效、评分条件 GT/LT 误用 |
| FR-8.7 | 重复图标修复 | 移除进化球员的重复特技图标 |
| FR-8.8 | GK 显示临时修复 | 26.09 加入，作者注明"临时修复，如出现问题请删除"（`fsu.js:15559`） |

**边界 [显式]**：基础属性需按需加载，未载入时提示"请点击左侧+按钮"；标注"*为直接加成的卡面属性，此处为预估"。

### FR-9 球员自动购买 [显式标注为测试版 —— 入口已被禁用，当前不可达]

> **重要**：`UTTransfersHubView.prototype.init` 里在调用原方法后紧接一句 `return;`，
> 后面创建入口 tile 的代码全是死代码，而 `events.goToAutoBuy` 的唯一调用点就在这段死代码里。
> 也就是说本模块（`fsu.js:12229-12760`，约 530 行）目前**没有任何可达入口**。下表是代码里实现了什么，不是用户能用到什么。

| ID | 功能 | 说明 |
|---|---|---|
| FR-9.1 | 入口 | 独立页面，tile 文案含"测试版，如出现问题请停止使用" |
| FR-9.2 | 球员搜索 | 按名称搜索，须选中后才能搜 |
| FR-9.3 | 右侧信息面板 | 双 TAB（操作/信息）：最新挂牌、最新成交、奖励物品、不可交易标识，可跳拍卖历史 |
| FR-9.4 | 价格区间与数量 | 最低/最高购买价、购买数量；支持"使用最近挂牌价" |
| FR-9.5 | 购买执行与日志 | 购买进度、成功/失败分类（被抢/金币不足/无拍卖信息/超时/未分配过多），批量结束汇总 |

### FR-10 目标与奖励

| ID | 功能 | 说明 | 开关 |
|---|---|---|---|
| FR-10.1 | 目标顶部统计 | 今日新增数、即将到期、可领奖励 | `info_obj` |
| FR-10.2 | 赛季目标奖励价值 | 赛季与非赛季目标的奖励预估价值 | — |
| FR-10.3 | 奖励概率展示 | 获奖弹窗展示开包概率 | — |
| FR-10.4 | 奖励预览 | 奖励选择弹窗的目录与选中态增强 | — |
| FR-10.5 | 首页数字修复 | 修 EA 目标首页计数不更新 | — |

### FR-11 球员管理

| ID | 功能 | 说明 |
|---|---|---|
| FR-11.1 | 锁定球员 | 标记球员为锁定，独立列表查看，填充/提交时规避 |
| FR-11.2 | SBC 仓库 | 独立页面；显示可发送回俱乐部数量，支持批量发送 |
| FR-11.3 | 未分配列表 | 总人数与总价、刷新、重载名单、截图文案 |
| FR-11.4 | 俱乐部入口按钮 | 俱乐部页插入快捷入口 |
| FR-11.5 | 可放仓库数量 | 未分配界面显示可放入仓库的数量 |

### FR-12 评分体系

| ID | 功能 | 说明 |
|---|---|---|
| FR-12.1 | GGRating | fut.gg metarank 分数 → S/A/B/C/D 分级（S=前 1-10、A=11-50、B=51-100、C=101-300、D=其他，仅前 3000 名有数据，门将只到 C 级）。进化球员按评分差做修正 |
| FR-12.2 | FG 评分 | 本地复算 FUT.GG 算法：按位置×角色组合算最佳分与推荐默契。输入含属性、逆足、花式、惯用脚、特技、金特技、身高、体重、体型、角色熟悉度（+/++）、是否 Icon |
| FR-12.3 | Meta 属性本地缓存 | 拦截 EA 的 `/attributes/metadata` 响应落本地，补全 EA 未下发的球员属性；按赛季分键 |
| FR-12.4 | 职责评级说明 | 弹窗解释推荐职责、默契风格、职责概述、同职责满默契级别 |
| FR-12.5 | 战术界面评分 | 战术角色选择界面显示 meta 评分（**当前整段被注释**，`fsu.js:2215`） |

### FR-13 其他

| ID | 功能 | 说明 |
|---|---|---|
| FR-13.1 | 球员图片缓存 | IndexedDB 存球员图，带过期清理（`events.getDB` / `saveImageToIndexedDB` / `getImageByName`） |
| FR-13.2 | FUTGG 转发代理 | 可配自建转发地址绕过 fut.gg 直连限制，格式须 `https://***/` |
| FR-13.3 | 快捷键 | `events.hotKeysBind` 维护元素注册表，但 **keydown 监听器整段被注释（`fsu.js:15584`），功能未启用** |

---

## 4. 数据需求

### DR-1 外部接口

#### 4.1.1 FSU 配置源（`api.fut.to/{赛季}/`）

版本校验入口 `updata.json` 返回 `{version, updateURL, api:{<名称>:<版本戳>}}`，再按 `api` 里存在的键拉取对应文件（版本戳作为 query 用于 CDN 失效）。

| 文件 | 消费字段 | 用途 | 缺失影响 |
|---|---|---|---|
| `meta.json` | `bodyType`、`baseBodyType`、`realFace` | 体型与真实脸 | FR-2.3 退化 |
| `fast.json` | `{sbc键: {t:过期, g:方案}}` | 快速 SBC 方案 | FR-4.12 无方案 |
| `pack.json` | 开包概率表 | FR-7.4 / FR-10.3 | 概率不可用 |
| `sbc.json` | `{stat, new[], reward[]}` | SBC 顶部统计 | FR-4.1 无数据 |
| `ggrating.json` | `{rating{}, rank{}}` | GGRating 分级阈值 | FR-12.1 退回原始分 |
| `evolutions.json` | `new[]` | 新进化任务 | FR-8.1 无新增标识 |
| `inpacks.json` | `{defIds, rarityIds}` | 包内球员池 | FR-7.6 空 |
| `other.json` | `{dynamic, chem}` | 特殊品质（动态升级/默契提升） | FR-2.8、FR-7.7 空 |
| `fgconfig.json` | 属性权重、角色、身高体重区间、特技系数等 | FG 评分 | FR-12.2 整体关闭 |
| `playermeta.json` | `[defId, 体型, 体重, 真实脸]` | 球员静态元数据 | FR-2.3 退化 |
| `lowprice.json` | `{pc:{}, ps:{}}` | 评分低价表 | FR-3.4 造价预估不可用 |

**[待确认]** 27 赛季该源返回 404，上游未发布。可用 `GM_setValue("apibase", ...)` 换自建源，JSON 契约照上表。

#### 4.1.2 价格与数据源

| 源 | 端点 | 用途 |
|---|---|---|
| fut.gg | `/api/fut/player-prices/{赛季}/?ids=&platform=` | 主力批量价格 |
| fut.gg | `/api/fut/metarank/players/?ids=` | GGRating 分数 |
| fut.gg | `/api/squads/{id}` | SBC 方案导入 |
| futnext | `/players/prices?ids=&platform=` | 备用批量价格 |
| futnext | `/{dir}/{pack}/{id}/open`、`/pack/{pack}/{id}/` | 真实开包概率与球员图 |
| futbin | `/futbin/api/{赛季}/fetchPriceInformation`、`fetchPlayerInformationMinimal`、`searchPlayersByName`、`getFilteredPlayers`、`getChallengesBySetId`、`getChallengeTopSquads`、`getSquadByID` | 单球员价格、ID 反查、SBC 方案 |
| EA UTAS | `/ut/game/fc{赛季}/transfermarket` | 实时在售最低价（带 `X-UT-SID`） |

**安全约束 [显式]**：EA 会话令牌 `X-UT-SID` 只发给 EA 自己的 UTAS 域名，未外传。全文无 `eval` / `new Function` / 动态 `<script>` 注入，远端只收 JSON 数据。

### DR-2 本地存储（GM storage）

| 键 | 内容 | 赛季隔离 |
|---|---|---|
| `set` | 功能开关与数值配置 | 否（跨赛季复用） |
| `build` | 填充排除偏好 | 否 |
| `apiproxy` / `apibase` | 自建转发地址 / 自建数据源 | 否 |
| `packsSort` | 商店排序偏好 | 否 |
| `SBCCount` | 当日提交数（按天自重置） | 否 |
| `lock_{赛季}` | 锁定球员 ID | 是 |
| `futbinId_{赛季}` | defId → FUTBIN ID 映射 | 是 |
| `ggr_{赛季}` | GGRating 缓存（7 天 TTL） | 是 |
| `sbclist_{赛季}` | 顶部快捷入口 SBC ID | 是 |
| `history_{赛季}` | 转会搜索历史 | 是 |
| `academy_{赛季}` | 进化任务名称缓存 | 是 |
| `playerMetaData_{赛季}` | 拦截到的球员 meta | 是 |
| `players` | **死键**，只写不读（`fsu.js:6872`） | — |

另有 IndexedDB 存球员图片。

---

## 5. 非功能需求

| ID | 项 | 要求 | 依据 |
|---|---|---|---|
| NFR-1 | 原方法不可破坏 | 所有覆写必须先调原方法，异常不得阻断 EA 原生流程 | AR-1 |
| NFR-2 | 远端数据可缺失 | 任一外部源不可用时只降级对应功能，不影响其他功能（27.00 已补三处容错） | `MIGRATION-FC27.md` §2.4 |
| NFR-3 | 长任务可中断 | 批量操作须显示进度并支持用户中止 | FR-1.6 |
| NFR-4 | 批量操作限速 | 快速 SBC / 批量挂牌须有节流与风险提示，避免触发 EA 风控 | FR-4.11、FR-4.12 |
| NFR-5 | 双端适配 | 所有新增 UI 须适配 PC 与手机端布局与默认值 | `isPhone()` |
| NFR-6 | 三语支持 | 新增用户可见文案必须三语齐备 | AR-3 |
| NFR-7 | 资源可回收 | 注入的 DOM 与事件须在界面销毁时释放 | AR-5 |
| NFR-8 | 跨赛季缓存隔离 | 含球员/SBC/FUTBIN ID 的缓存必须按赛季分键 | DR-2 |
| NFR-9 | 会话令牌不外传 | `X-UT-SID` 仅可发往 EA 域名 | DR-1 |
| NFR-10 | 无远程代码执行 | 远端只允许返回数据，不得执行 | DR-1 |

---

## 6. 设置项全集

### 6.1 开关型（`info.setfield`，默认全开）

| 分组 | 键 | 标签 |
|---|---|---|
| 球员卡信息 | `card_pos` / `card_price` / `card_other` / `card_club` / `card_low` / `card_meta` | 额外位置 / 球员价格 / 其他属性 / 俱乐部内球员 / 评分低价 / 球员元评分&排名 |
| 选中球员操作 | `player_auction` / `player_futbin` / `player_getprice` / `player_loas` / `player_uatoclub` / `player_transfertoclub` / `player_pickbest` | 按低价快速拍卖 / 前往FUTBIN查看 / 查询拍卖低价 / 批量拍卖球员 / 未分配外部发送至俱乐部 / 转会发送俱乐部 / 球员挑选最佳提示 |
| SBC 操作 | `sbc_top` / `sbc_right` / `sbc_quick` / `sbc_duplicate` / `sbc_records` / `sbc_input` / `sbc_icount` / `sbc_template` / `sbc_templatemode` / `sbc_market` / `sbc_sback` / `sbc_cback` / `sbc_dupfill` / `sbc_autofill` / `sbc_squadcmpl` / `sbc_conceptbuy` / `sbc_meetsreq` / `sbc_headentrance` | 阵容顶部按钮 / 阵容右侧按钮 / 快捷添加球员 / 重复球员填充 / 选项记录 / 信息输入检索 / 搜索球员数量显示 / SBC方案填充 / 填充输入模式 / 假想球员拍卖搜索优化 / 阵容回退 / 假想球员购买自动分配 / 重复球员填充阵容 / 一键填充球员 / 阵容补全功能 / 假想球员直接购买 / （**无标签**） / 顶部SBC入口 |
| 信息展示 | `info_obj` / `info_sbc` / `info_sbcf` / `info_sbcs` / `info_pack` / `info_squad` / `info_skipanimation` / `info_sbcagain` / `info_packagain` | 目标顶部显示 / SBC顶部显示 / SBC筛选 / SBC子任务 / 球员包可开球员 / 阵容价值 / 跳过开包动画 / 商店快速SBC / 商店快速开包 |

### 6.2 数值与列表型

| 键 | 默认值 | 范围 | 说明 |
|---|---|---|---|
| `card_style` | 2 | 1=纯色 / 2=随品质 | 卡片信息样式 |
| `goldenrange` | 83 | 76-99 | 黄金球员评分上限 |
| `queries_number` | 5 | ≥1 | 拍卖低价查询次数 |
| `headentrance_number` | PC 5 / 手机 3 | 1-8 | 顶部 SBC 入口数量 |
| `shield_league` | `[31,16,13,19,53]` | 联赛 ID 列表 | 排除联赛（需开 `build.league`） |
| `shield_flag` | `[]` | 稀有度 ID 列表 | 可使用的特殊球员品质（需开 `build.flag`） |

### 6.3 填充偏好（`build.*`）

`league`（排除指定联赛）、`untradeable`（仅不可交易）、`ignorepos`（忽略位置）、`academy`（排除进化球员）、`strictlypcik`（挑选严格普通稀有）、`firststorage`（优先仓库球员）、`flag`（可使用特殊球员）、`rare`、`sbfirstcommon`（银铜优先普通）、`comprare`（补全优先非特殊）、`comprange`（补全黄金范围内优先稀有）

---

## 7. 已知缺陷与死代码

| 项 | 位置 | 性质 |
|---|---|---|
| `sbc_meetsreq` 无 i18n 标签 | `fsu.js:86` vs i18n 表 | 设置页显示原始键名 |
| `set.player.swapt` 有标签但不在 `setfield` | i18n 表 | 开关不会被生成 |
| **球员自动购买入口被禁用** | `fsu.js:12679` | `UTTransfersHubView.init` 里一句 `return;` 让建入口 tile 的代码成死代码，`events.goToAutoBuy` 唯一调用点也在其中 → 约 530 行（`12229-12760`）完全不可达 |
| 快捷键功能未启用 | `fsu.js:15584` | keydown 监听整段注释 |
| 战术界面 meta 评分未启用 | `fsu.js:2215` | 整段注释 |
| `card_meta` 的 fut.gg 分支被 `&& false` 关闭 | `fsu.js:2667`、`4414` | 意图不明 |
| `futgg()` 站点分支未启用 | `fsu.js:15759` | 调用被注释 |
| 赛事列表奖励展示未启用 | `fsu.js:11125` | 整段注释 |
| `players` 存储键只写不读 | `fsu.js:6872` | 死键 |
| GK 进化显示为"临时修复" | `fsu.js:15559` | 作者注明可删 |
| lodash 重复加载 | 元数据 `@require` ×2 | 两个 CDN 都会生效 |

---

## 8. 合规风险

| 功能 | 风险等级 | 说明 |
|---|---|---|
| FR-4.12 快速 SBC、FR-7.1 批量开包、FR-6.1 批量挂牌 | **高** | 属 EA ToS 明令禁止的自动化，封号风险真实存在。脚本自身也在 `fastsbc.popupm` 里警告"过量可能导致 BAN 提交等不知名惩罚"。三者开关默认全开（`set.init` 把 `setfield` 里所有项默认置 `true`），但都需用户显式点击才会执行 |
| FR-9 球员自动购买 | 不适用 | 代码在，但入口被作者禁用，当前不可达（见 §7） |
| FR-4.11 SBC 计数 | — | 本身是风控提示功能，提示"1 小时内超 90 个可能被禁止提交" |
| 信息展示类（FR-2、FR-3、FR-10、FR-12） | 低 | 只读展示与第三方比价 |
| FR-7.4 模拟开包 | 低 | **[显式]** 纯本地计算，不与 EA 交互 |

---

## 9. 本文档的缺失部分

反推无法得到、需要人工补充的内容：

1. **验收标准** —— 每条 FR 的"做到什么程度算完成"
2. **优先级** —— 哪些功能是核心、哪些可砍
3. **性能指标** —— 批量操作的时限、单次请求量上限的设计依据
4. **算法设计依据** —— FG 评分权重、默契阈值、黄金范围 83 这些数值的来源
5. **接口契约的完整定义** —— 上表只列出被代码消费的字段，未被消费的字段不可见
6. **第 4 层游戏数据常量的正确值** —— PlayStyle ID 段、化学风格表、联赛 ID 等（见 `MIGRATION-FC27.md` §3.3）
