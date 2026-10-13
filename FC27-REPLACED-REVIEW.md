# 完全替换型方法复核（FC27）

`FC27-HOOK-REPORT.md` 列出 6 个 fsu **整体重写、不调用原方法**的 EA 方法。
符号存在不代表安全 —— EA 若改了内部逻辑，fsu 跑的就是过时实现。本文是逐个对比的结论。

| 项 | 值 |
|---|---|
| 对比基准 | `reference/webapp/all.js`（web app build 11414，FC27） |
| 对比日期 | 2026-10-13 |
| 方法 | `node tools/ea-impl.js <Class>.prototype.<method>` 抽 EA 实现，与 `fsu.js` 逐行比 |

## 结论汇总

| 方法 | 结论 | 说明 |
|---|---|---|
| `UTHomeHubView.getSBCTile` | ✅ 安全 | EA 是一行 getter，fsu 完整保留返回值 |
| `UTHomeHubView.getObjectivesTile` | ✅ 安全 | 同上，额外依赖已核 |
| `UTHomeHubView.getAcademyTile` | ✅ 安全 | 同上 |
| `UTPackAnimationViewController.runAnimation` | ✅ 安全 | 与 EA FC27 实现**逐行一致** |
| `UTSBCSetsViewModel.getCategories` | ⚠️ 1 项待运行时确认 | 构造签名完全匹配，但 `EAIterator.add` 在混淆层查不到 |
| `UTSquadBuilderViewModel.generatePlayerCollection` | 🔴 **发现崩溃 bug，已修** | 见下 |

---

## 🔴 generatePlayerCollection —— 已修的崩溃 bug

### EA FC27 实现

```js
UTSquadBuilderViewModel.prototype.generatePlayerCollection = function (e, i, o, n) {
    var r = this;
    return e.map(function (e, t) {
        t = n ? n.getSlot(t) : null;                       // ← n 可为空，有保护
        return t && (t.isValid() || t.isBrick()) ? t.item
             : o ? i.shift() || null                       // ← 用尽时补 null
             : r.getBestPlayerForPos(e, i);
    });
};
```

### 问题

EA 自己的调用点有两个分支（`reference/webapp/all.js`，`this.replacePlayers` 三元）：

```js
this.replacePlayers
  ? squadBuilder.buildSquad(this.formation, i, this.ignorePosition)              // 3 参：squad 省略
  : squadBuilder.buildSquad(this.formation, i, this.ignorePosition, this.squad)  // 4 参
```

`buildSquad` 原样把 4 个参数传给 `generatePlayerCollection`，所以
**"替换球员"模式下第 4 个参数 `r` 是 `undefined`** —— 这是 EA 有意为之：
`n ? n.getSlot(t) : null` 让所有位置都被当成空位，从而实现"全部替换"。

fsu 的实现在函数顶部统计空位时**没有这个保护**：

```js
for (let i = 0; i < 11; i++) {
    if (!r.getSlot(i).isValid() && !r.getSlot(i).isBrick()) {   // r 为 undefined → TypeError
```

→ `TypeError: Cannot read properties of undefined (reading 'getSlot')`

**影响范围**：因为 fsu 是整体替换，崩的不只是 fsu 自己的排除/提示功能，
**EA 自带的阵容建设器"替换球员"流程也一起坏掉**。

### 已应用的修复（`fsu.js:7632-7640`）

```js
for (let i = 0; i < 11; i++) {
    const slot = r ? r.getSlot(i) : null;
    if (!slot || (!slot.isValid() && !slot.isBrick())) {
        v++;
    }
}
```

同时对齐了另一处与 EA 的细微不一致：`p[c++]` 在球员用尽时产出 `undefined`，
EA 原实现是 `i.shift() || null`，已改为 `p[c++] ?? null`，避免 `undefined` 流到
`squad.setPlayers()` 下游。

### 刻意保留的差异（不是 bug）

| 点 | EA | fsu | 判断 |
|---|---|---|---|
| 第 3 参 `ignorePosition` | 用调用方传入值 | 改用自己的 `info.build.ignorepos` 设置 | fsu 的"忽略球员位置"开关就是这个语义，有意替换 |
| 取槽位球员 | `t.item` | `i.getItem()` | `UTSquadSlotEntity.prototype.getItem` 实现就是 `return this.item`，**完全等价** |
| 候选池 | 不过滤 | 先按排除联赛 / 排除稀有过滤 | fsu 的核心功能 |
| 空位不足 | 无提示 | 弹 `notice.builder` | fsu 增强 |
| 收尾 | 无 | `events.loadPlayerInfo(pa)` 预取价格 | fsu 增强 |

空位循环硬编码 `i < 11` 是有意的 —— `e`（位置数组）含替补和预备席（`generalPositions`
拼 `preferredSubPositions`、`preferredResPositions`），但"球员不够"的提示只针对首发 11 人。

---

## ⚠️ getCategories —— 1 项需运行时确认

### EA FC27 实现

```js
UTSBCSetsViewModel.prototype.getCategories = function () {
    return this.categoriesIterator.values();
};
```

fsu 完整保留了这个返回值，只在其之前插入一个"快速任务"分类。

### 依赖核对

| 依赖 | 结论 |
|---|---|
| `this.categoriesIterator.values()` | ✅ EA 自己也这么用 |
| `UTSBCCategoryDTO(id, priority, name, type)` | ✅ FC27 签名 `function UTSBCCategoryDTO(t,e,i,o)` = `(id, priority, name, type)`，与 fsu 调用 `(996, 996, label, SERVER)` **完全匹配** |
| `SBCCategoryType.SERVER` | ✅ 存在（枚举有 `SERVER` / `CUSTOM_ALL` / `CUSTOM_FAVOURITE`） |
| DTO 的 `setIds` / `displayable` | ✅ 构造函数里就初始化为 `[]` 和 `!1`，fsu 覆写它们是正确用法 |
| `categoriesIterator.add(dto, 2)` | ⚠️ **查不到** |

### 为什么 `add` 查不到

`categoriesIterator = new EAIterator`，而 `EAIterator` 定义在 **`ocompiled.js`（混淆的框架引导层）**，
方法名是计算属性（`EAIterator.prototype[a0_0x3d0bf6(0x123)]`），字符串数组是 RC4+base64 编码的。
解码需要执行这段混淆代码，不做。

EA 自己对该迭代器只调 `current` / `get` / `getIndex` / `resetCollection` / `setIndex` / `values`，
**没有用到 `add`**，所以也无法从调用方反推。

### 判断与验证方式

框架层（`EAIterator` / `EAObservable` / `EAViewController` / `EAObject`）是跨赛季最稳定的一层，
且 fsu 26.09 在 FC26 上能用，`add` 大概率仍在。登录后一行确认：

```js
typeof new EAIterator([]).add    // 期望 "function"
```

**当前优先级低**：该分支要求 `info.base.fastsbc` 非空，而它来自 `api.fut.to/27`（现为 404），
所以这段代码目前根本不会执行。

---

## ✅ 三个首页 tile —— 安全

EA 的三个方法都是一行 getter：

```js
UTHomeHubView.prototype.getSBCTile        = function () { return this._sbcTile };
UTHomeHubView.prototype.getObjectivesTile = function () { return this._objectivesTile };
UTHomeHubView.prototype.getAcademyTile    = function () { return this._academyTile };
```

fsu 三个版本都是「条件插入一个 `.fsu-task` 角标 → 原样 return」，EA 行为 100% 保留。
真正的风险在用到的私有字段，已全部核对：

| 依赖 | 结论 |
|---|---|
| `_sbcTile` / `_objectivesTile` / `_academyTile` | ✅ 分别是 `UTGraphicalInfoTileView` / `UTObjectivesHubTileView` / `UTAcademyHubTileView` |
| `.__root` / `.__tileContent` | ✅ 在基类 `UTTileView.prototype._generate` 里创建，三个 tile 都继承 |
| `UTServerSettingsRepository.KEY.META_FCAS_ENABLED` | ✅ 存在（EA 自己用了 10 次） |
| `services.Configuration.serverSettings.setSettingByKey` | ✅ `FCServerSettingsRepository.prototype.setSettingByKey` |

`getObjectivesTile` 里那句"强制开启目标任务"（把 `META_FCAS_ENABLED` 写成 1）依赖的两个符号都在，
但它改的是**本地服务端配置缓存**，属于绕过 EA 功能开关的行为，是否保留由你决定。
顺带一提，这个方法里有一句每次调用都执行的 `console.log`，建议删掉。

---

## ✅ runAnimation —— 安全

fsu 的实现与 EA FC27 的实现**逐行一致**，只多了跳过动画的条件：

| | EA FC27 | fsu |
|---|---|---|
| 守卫 | `this.running \|\| (...)` | `if (!this.running) {...}` |
| 取 rarity | `services.Configuration.getItemRarity(this.presentedItem)` | 相同 |
| `setPackTier` / `generateItem` | 相同顺序 | 相同 |
| `runAnimation` | 无条件调用 | 包在 `if(!info.set.info_skipanimation)` 里 |
| 回调延时 | `4500` | `info.set.info_skipanimation ? 0 : 4500` |

连 `4500` 这个魔数都没变 —— 说明 EA 这块从 fsu 当初抄写时起就没动过。
依赖的 `UTPackAnimationView.prototype.setPackTier` / `generateItem` / `runAnimation` 均已确认存在。

---

## 复核方法（可复用）

```bash
# 抽 EA 的某个方法实现（自动花括号配平 + 简易美化）
node tools/ea-impl.js UTSquadBuilderViewModel.prototype.generatePlayerCollection
node tools/ea-impl.js UTHomeHubView.prototype.getSBCTile --raw

# 查某个类的全部方法
grep -ohE "UTSBCService\.prototype\.[A-Za-z0-9_$]+" reference/webapp/all.js \
  | sed 's/.*prototype\.//' | sort -u

# 查某个符号在 FC27 是否还存在
grep -oc "\bNetworkErrorManager\b" reference/webapp/all.js
```

**局限**：本复核只比对了逻辑与符号，没有比对 DOM 结构与 CSS 类名。
fsu 大量依赖 EA 的 DOM（`.fsu-task` 插入点、`querySelector` 选择器等），
这部分只能实机验证。
