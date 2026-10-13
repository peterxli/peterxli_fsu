# FC27 新增 SBC 形态：One-Click / Streamlined SBC

FC27 引入了一种**完全不基于阵容**的 SBC。fsu 整个 SBC 模块（需求文档 FR-4，最大模块）
建立在"阵容 + 位置 + 默契 + 评分"模型上，对这种新形态**完全无效**。

| 项 | 值 |
|---|---|
| 调查日期 | 2026-10-13 |
| 证据来源 | `reference/webapp/all.js`（build 11414）+ FUTBIN FC27 页面实地查看 |

## 一、两边的叫法

| | 名称 | 标识 |
|---|---|---|
| EA web app | **One-Click SBC** | `SBCChallengeType.ONE_CLICK`、`UTSBCSetEntity.isOneClickSBC()` |
| FUTBIN | **Streamlined SBC** | 分类 `Streamlined`、字段 `ITEM SCORE` |

FUTBIN 当前 24 个 FC27 SBC 里，`Streamlined` 分类占 12 个 —— **一半**。

## 二、玩法变了什么

| | 传统 SBC | One-Click SBC |
|---|---|---|
| 提交单位 | 11 人阵容 | 任意数量的单卡 |
| 约束 | 阵型 / 位置 / 默契 / 队伍总评 / 联赛国籍等条件 | **只有一个数字：item score 总和达标** |
| 上限 | 阵容 11 人 | 服务端下发 `ONE_CLICK_SBC_SUBMIT_LIMIT`（FUTBIN 界面默认 32） |
| 判定 | `UTSBCChallengeEntity` 的各类 requirement | `UTSBCSetEntity.scoreRequirement > 0` |
| 单卡贡献 | 无此概念 | `item.sbsScore`（服务端字段，也叫 `gradingScore`） |

### item score 的经济性（FUTBIN 解算器实测）

| 卡 | 价格 | item score | 单位分成本 |
|---|---|---|---|
| 84 评分 | 950 币 | **830** | 1.14 币/分 |
| 63 评分 | 200 币 | **20** | 10 币/分 |

**score 随评分陡增**，所以最优解是"便宜的高评分卡"，和传统 SBC"凑评分凑默契"的思路完全不同。

FUTBIN 给出的参考曲线（任意人数、最便宜解）：

| 需要 score | 最低成本 | 用卡数 |
|---|---|---|
| 2.5K | 3.05K | 4 |
| 10K | 11.8K | 14 |
| 25K | 29.15K | 31 |
| 70K | 80.45K | 85 |

整体约 **1 分 ≈ 1.15 币**。

## 三、web app 侧新增的代码（fsu 完全没有）

**22 个新类、约 250 个方法**，核心：

```
UTOneClickSBCWorkAreaViewModel        选卡状态机：_itemScoreMap / _selectedItemIds /
                                      getSelectedScore / autoSelectCurrentPage /
                                      getSelectionLimit / isSelectionLimitReached
UTOneClickSBCWorkAreaSplitViewController   主界面（对应传统流程的 UTSBCSquadSplitViewController）
UTOneClickSBCItemGridView             选卡网格，支持拖拽多选
UTOneClickSBCReviewViewController     提交前复核
UTOneClickSBCFiltersView              筛选（可交易状态 / 排序方向）
UTOneClickSBCSubmitConfirmPopupView   提交确认（含 setOverLimit）
UTOneClickSBCCompensationPopupView    补偿弹窗
UTSBCService.initiateOneClickChallenge / submitOneClickChallenge / _applyOneClickSubmission
```

服务端开关：`ONE_CLICK_SBC_ENABLED`、`ONE_CLICK_SBC_SUBMIT_LIMIT`、
`ONE_CLICK_SBC_SORT_DIRECTION`、`ONE_CLICK_SBC_TRADE_STATUS`。

### 路由分叉点

```js
UTSBCHubViewController.prototype._enterHiddenSet = function (i, o) {
    i.isOneClickSBC()
        ? this._routeToOneClickChallenge(i, o)      // ← 新链路，fsu 一个 hook 都没有
        : this._viewmodel.loadChallenge(o)...        // ← 传统链路，fsu 的全部增强在这里
};
```

进入 SBC 的那一刻就分成两条路，**One-Click 永远不会走到 `UTSBCSquadOverviewViewController`**。

## 四、对 fsu 的具体影响

### 完全失效（One-Click SBC 下不触发）

| fsu 功能 | 原因 |
|---|---|
| 一键填充 / 重复球员填充 / 阵容补全 | 挂在 `UTSBCSquadOverviewViewController`，不在新链路 |
| 抄作业（导入 FUTBIN/FUT.GG 方案） | One-Click **没有阵容**，方案概念不存在 |
| 默契球员名单 / 算评分 / 需求球员统计 | 全部基于阵容模型 |
| 提交拦截（重复球员交换、珍贵球员确认） | 挂 `UTSBCSquadOverviewViewController._submitChallenge` |
| 阵容回退 | 同上 |
| **SBC 计数与风控提示** | 挂 `UTSBCService.submitChallenge`；One-Click 走 `submitOneClickChallenge`（内部调 `sbcDAO.submitPlayers`）→ **提交不计数，风控提示失真** |

### 仍会触发，但显示可能无意义

| fsu hook | 风险 |
|---|---|
| `UTSBCHubView.populateTiles` / `populateNavigation` | SBC 列表仍是同一个 hub，tile 增强会渲染 —— 但"造价预估""阵容价值"对 One-Click 没有意义，很可能显示 0 或错值 |
| `UTSBCSetTileView.setData` | 同上 |
| `UTSBCRequirementsView.render` | **One-Click 复用了这个视图类**（`UTOneClickSBCRequirementsViewController._getViewInstanceFromData` 返回 `new UTSBCRequirementsView`），所以 fsu 的"快速完成"按钮逻辑会在 One-Click 需求面板里跑 |

关于最后一条：实测不会崩。fsu 这个 hook 是包装型（先调原方法），
且 `const sName = \`${e.id}#${e.setId}\`` 的 `e` 来自 `viewModel.getChallenge()`，
是正常的 `UTSBCChallengeEntity`，字段齐全；之后的逻辑被 `_.has(info.base.fastsbc, sName)` 挡住，
而 `info.base.fastsbc` 因 `api.fut.to/27` 404 恒为空 → 整段不执行。
**但如果将来数据源恢复，这个按钮会在 One-Click 界面出现并执行阵容逻辑，届时会出问题。**

## 五、FUTBIN 侧的应对（可作为功能设计参考）

FUTBIN 为此新建了两个工具：

| 路径 | 作用 |
|---|---|
| `/27/squad-building-challenges/streamlined-sbc-solver` | 输入"还差多少 score"+ 最大人数 + 平台 → 解出最便宜的卡组合，给出总价、达成分数、用卡数，每种卡标 ×数量 并可勾"Mark complete" |
| `/27/squad-building-challenges/cheapest-item-score` | 按"每币 score 性价比"排卡 |

这正是 fsu 若要支持 One-Click SBC 需要做的事 —— 本质是一个**有数量上限的背包/找零问题**
（目标 score，最小化金币），输入是俱乐部内球员的 `sbsScore` 和市场价。

值得注意的是：fsu 做这件事比 FUTBIN 有优势 —— 它能直接读到**你俱乐部里实际拥有的卡**
（`repositories.Item.club.items` + 仓库），而 FUTBIN 只能按市场价给通用解。

## 六、已做的三项改动（2026-10-13）

### 1. `UTSBCRequirementsView.render` 加 One-Click 判定 ✅

`fsu.js:13798`。One-Click 的需求面板复用了这个视图类，fsu 的"快速完成"是阵容逻辑，必须让开：

```js
if(e?.isOneClickChallenge?.()){
    this._fsu?.fastSbcBtn?.hide();
    return;
}
```

现在不加也不会崩（`info.base.fastsbc` 因数据源 404 恒为空），但数据源一旦恢复就会在新界面注入无效按钮。

### 2. SBC 计数覆盖 One-Click 提交路径 ✅

`fsu.js:11850-11886`。计数逻辑抽成 `SBCCount.record()` / `SBCCount.observeSubmit()`，
传统的 `submitChallenge` 与新的 `submitOneClickChallenge` 共用：

```js
if(typeof UTSBCService.prototype.submitOneClickChallenge === "function"){
    const originalSubmitOneClick = UTSBCService.prototype.submitOneClickChallenge;
    UTSBCService.prototype.submitOneClickChallenge = function(i, o, r) {
        return SBCCount.observeSubmit(this, originalSubmitOneClick.apply(this, arguments));
    };
}
```

带 `typeof` 守卫，回退到 FC26 不会报错。
两条路径返回的都是 `EAObservable` + `UTServiceResponseDTO{success}`，观察器可直接共用；
One-Click 遇到阵容冲突时 EA 会把 `success` 置 false，所以不会误计数。

### 3. 子任务行的 FUTBIN 数据缺失保护 ✅（原提法已修正）

`fsu.js:5261`。**原先计划的"改显示 scoreRequirement"是基于不完整信息的，已放弃**，理由：

- EA 自己已经在 set tile（`UTSBCSetTileView.setData` 里 `isOneClickSBC()` 分支）和子任务行
  （`UTSBCChallengeTableRowView._renderScore`）渲染了 `submittedScore / scoreRequirement`，fsu 再加一遍是重复
- FUTBIN 对 Streamlined SBC **是有成本估算的**（列表里 ITEM SCORE 11000 对应 13K），
  所以"造价预估"对 One-Click 并非无意义

真正的风险在别处 —— 原代码：

```js
const child = sbcStat.child[sId];
child.price ??= Number(...);     // child 为 undefined 时 TypeError
```

FUTBIN 未收录该子任务时就会炸，而 One-Click 这种新类型最容易缺数据。已改为缺数据时 `continue` 跳过该行。

### 验证

`node --check` 通过；重跑离线审计，包装型 hook 从 99 增至 **100**，
新增的 `submitOneClickChallenge` 被正确识别为包装型且在 bundle 中存在，缺失项仍为 0。

## 六之二、仍未做的大工程

**按俱乐部库存解 One-Click 最优卡组合**，挂 `UTOneClickSBCWorkAreaViewController`。
本质是有数量上限的背包问题（目标 score，最小化金币）。
fsu 做这件事比 FUTBIN 有优势 —— 能直接读 `repositories.Item.club.items` + 仓库里**实际拥有的卡**，
而 FUTBIN 只能按市场价给通用解。这是独立的新功能开发，不在本次迁移范围内。

## 七、本文的局限

- 全部结论来自 bundle 静态分析 + FUTBIN 公开页面，**未在登录态实机验证**
- `sbsScore` 的具体计算公式不在 bundle 里（服务端下发），只能观测到"随评分陡增"
- fsu 的 futbin.org API（抄作业用）在 FC27 是否仍可用**未能验证** ——
  浏览器内 fetch 被 CORS 挡住，且 FC26 端点同样失败，该测试无效；
  fsu 用 `GM_xmlhttpRequest` 绕 CORS，只能装进篡改猴后实测
