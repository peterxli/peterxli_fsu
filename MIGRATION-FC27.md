# FSU 增强器 FC26 → FC27 迁移记录

| 项 | 值 |
|---|---|
| 基线 | `fsu-fc26.js`（26.09 原版留档，不要改） |
| 工作文件 | `fsu.js`（27.00） |
| 迁移日期 | 2026-10-13 |
| 语法校验 | `node --check fsu.js` 通过 |

---

## 一、赛季迁移分四层

| 层 | 内容 | 状态 |
|---|---|---|
| 1. 机械层 | URL / 存储键里的赛季号 | ✅ 已完成 |
| 2. 容错层 | 远端数据缺失时不炸 | ✅ 已完成 |
| 3. EA 前端层 | 107 处 prototype hook 是否还对得上 | ✅ 已离线比对完成，见 `FC27-HOOK-REPORT.md`（6 项待人工复核） |
| 4. 游戏数据层 | 写死的阵型 / 化学风格 / 联赛 ID 等常量表 | ⏳ 数据由服务器下发，需登录态才能核对 |

**第 3 层是怎么不登录就做完的**：FC27 web app 的 JS bundle 公开可下载（`tools/fetch-webapp.sh`），
5.4 MB 里只有引导层 `ocompiled.js` 做了字符串混淆，**1 万多处 `Class.prototype.method` 全是明文**，
所以 hook 存活性可以纯离线逐项字面比对，不需要浏览器、不需要账号。

---

## 二、已完成改动

### 2.1 赛季适配层（`fsu.js` 第 39-55 行）

所有与赛季绑定的东西统一从这里派生，**下个赛季只需改一个常量**：

```js
const FSU_SEASON_FALLBACK = 27;   // APP_YEAR_SHORT 取不到时的兜底赛季号
const FSU_API_DEFAULT = "https://api.fut.to";
const FSU_UTAS_FALLBACK = "https://utas.mob.v5.prd.futc-ext.gcp.ea.com";

fsuSeason()      // 赛季号：优先读 web app 自己的 APP_YEAR_SHORT，取不到用兜底值
fsuApi(file)     // → https://api.fut.to/27/<file>，可用 GM 键 "apibase" 整体换源
fsuKey(key)      // → "<key>_27"，按赛季隔离本地缓存
fsuUtas(path)    // → <运行时捕获的 UTAS 域名>/ut/game/fc27/<path>
```

赛季号的真实来源是 web app 自己的全局变量 `APP_YEAR_SHORT`，所以**只要 EA 不改这个变量名，脚本会自动跟着赛季走**，`FSU_SEASON_FALLBACK` 只是兜底。

### 2.2 具体替换点

| 原值 | 现值 | 处数 |
|---|---|---|
| `https://api.fut.to/26/*.json` | `fsuApi("*.json")` | 12 |
| `fut.gg/api/fut/player-prices/26/` | `player-prices/${fsuSeason()}/` | 2 |
| `utas.mob.v5...ea.com/ut/game/fc26/` | `fsuUtas(...)` | 1 |
| `info.base.year = APP_YEAR_SHORT` | `= fsuSeason()` | 1 |
| GM 键 `lock_26` | `fsuKey("lock")` | 2 |
| GM 键 `ggr` / `history` / `sbclist` / `academy` / `futbinId` | `fsuKey(...)` | 11 |
| GM 键 `` `playerMetaData_${info.base.year}` `` | `fsuKey("playerMetaData")` | 2 |

**保持不分赛季**（跨赛季复用的用户配置，不应清掉）：`set`、`build`、`apiproxy`、`apibase`、`packsSort`。
`SBCCount` 按天自重置，`players` 是只写不读的死键，都不动。

### 2.3 UTAS 域名改为运行时捕获

原来把 `utas.mob.v5.prd.futc-ext.gcp.ea.com` 写死在脚本里，EA 一改主机名（v5→v6）就失效。
现在在已有的 `XMLHttpRequest.prototype.open` 拦截里顺手抓 EA 自己的 UTAS 域名（`fsu.js:15492`），抓不到才用兜底值。
控制台会打印 `UTAS origin: ...`，可用来确认是否抓到。

> 注意：如果 FC27 web app 把网络层换成 `fetch`，这个捕获会失效并退回兜底域名。届时需要补一个 `fetch` 拦截。

### 2.4 远端数据缺失时的容错（重要）

实测 **`https://api.fut.to/27/updata.json` 返回 404** —— 原作者尚未发布 27 赛季的数据源（26 赛季的源仍在，`version: 26.09`）。
原代码在这种情况下有三处会直接抛异常，已修：

| 字段 | 原问题 | 处理 |
|---|---|---|
| `info.specialPlayers` | 远端 `other.json` 才赋值，缺失时包内球员页 / 特殊品质 tile 报 TypeError | 在 `info` 字面量里预置空结构 |
| `info.playermeta` | 远端 `playermeta.json` 才赋值，缺失时球员卡渲染报 TypeError | 预置 `{}` |
| `info.GGRRAR` | 远端 `ggrating.json` 才赋值，缺失时 GGRating 评级计算报 TypeError | 三处访问改可选链，缺失时退回未修正的原始评分 |

**没有**给 `info.fgconfig` 预置默认值 —— `events.fgCalc` 用 `_.has(info,"fgconfig")` 判断 FG 功能是否可用，预置了反而会让它带着空配置进去跑崩。

### 2.5 修复 FC27 移除的全局 `NetworkErrorManager`

离线比对查出的唯一真实破坏性变更：

| | FC26 | FC27 |
|---|---|---|
| 调用方式 | 全局 `NetworkErrorManager.checkCriticalStatus(s)` | 实例 `getAppMain().getNetworkErrorController().checkCriticalStatus(s)` |
| 符号 | 全局存在 | **bundle 中 0 次出现**，改名为 `NetworkErrorController` 类 |
| 方法签名 | `checkCriticalStatus(s)` / `handleStatus(s)` | 两者签名未变 |

`fsu.js` 有 12 处调用，不修会全部抛 `ReferenceError`。已加兼容层（`fsu.js:59`）并替换全部调用点：

```js
const fsuNetErr = () => (typeof NetworkErrorManager !== "undefined"
    ? NetworkErrorManager
    : getAppMain().getNetworkErrorController());
```

写成两季兼容，老赛季有全局时直接用，所以不影响回退到 FC26 调试。

### 2.6 修复阵容建设器"替换球员"模式崩溃

`UTSquadBuilderViewModel.generatePlayerCollection` 是 fsu **整体替换**的方法。
EA 在 FC27 的调用点有两个分支：

```js
this.replacePlayers
  ? squadBuilder.buildSquad(this.formation, i, this.ignorePosition)              // 3 参，squad 省略
  : squadBuilder.buildSquad(this.formation, i, this.ignorePosition, this.squad)  // 4 参
```

省略第 4 参是 EA 有意为之（所有位置当空位 → 全部替换），EA 自己的实现用 `n ? n.getSlot(t) : null` 做了保护。
fsu 的替换版在函数顶部统计空位时**没有保护**，直接 `r.getSlot(i)` → `TypeError`。

因为是整体替换，崩的不只是 fsu 的功能，**EA 自带的阵容建设器"替换球员"流程也一起坏**。

已修（`fsu.js:7632-7640`），同时把 `p[c++]` 改为 `p[c++] ?? null`，与 EA 的 `i.shift() || null` 对齐，
避免 `undefined` 流到 `squad.setPlayers()` 下游。详细对比见 `FC27-REPLACED-REVIEW.md`。

---

## 三、待确认（这部分我做不了，需要你在 FC27 web app 里跑）

### 3.1 第 3 层：已离线完成，剩 6 项需人工复核

完整结果见 **`FC27-HOOK-REPORT.md`**。摘要（web app build 11414）：

| 类别 | 结论 |
|---|---|
| prototype 包装型 99 项 | ✅ 全部存在 |
| prototype 完全替换型 6 项 | ⚠️ 符号在，但 fsu 是整体重写，**需对比 EA 新实现** |
| prototype 新增型 2 项 | ✅ 宿主类都在 |
| 全局类/枚举 168 项 | ✅ 全部存在（修掉 `NetworkErrorManager` 后） |
| services 17 个 / repositories 7 个 | ✅ 全部存在 |

#### 6 项完全替换型已逐个复核完成 → `FC27-REPLACED-REVIEW.md`

| 方法 | 结论 |
|---|---|
| `UTHomeHubView.getSBCTile` / `getObjectivesTile` / `getAcademyTile` | ✅ 安全（EA 均为一行 getter，fsu 完整保留返回值） |
| `UTPackAnimationViewController.runAnimation` | ✅ 安全（与 EA FC27 实现逐行一致，连 4500ms 都没变） |
| `UTSBCSetsViewModel.getCategories` | ⚠️ 仅 `EAIterator.add` 需登录后一行确认；该分支目前休眠 |
| `UTSquadBuilderViewModel.generatePlayerCollection` | 🔴 **查出崩溃 bug，已修**（§2.6） |

#### 本次查出并修掉的两个真实问题

1. `NetworkErrorManager` 被 EA 移除（§2.5）
2. `generatePlayerCollection` 在"替换球员"模式下崩溃（§2.6）

#### 工具链

```bash
bash tools/fetch-webapp.sh     # 下载 FC27 bundle 到 reference/webapp/（公开，无需登录）
node tools/gen-audit.js        # 从 fsu.js 提取依赖 → tools/fsu-deps.json
node tools/static-audit.js     # 离线比对 → FC27-HOOK-REPORT.md
```

`tools/fc27-hook-audit.js`（控制台脚本）现在降级为**可选的运行时复查**手段 ——
静态比对已经覆盖了它能查的全部内容，且能额外区分包装/替换/新增，比控制台脚本更准。
它唯一的增量价值是能验证静态查不到的 19 个被混淆的 services 成员访问。

### 3.2 第 2 层：数据源

| 来源 | 用途 | 27 赛季状态 |
|---|---|---|
| `api.fut.to/27/*.json` | meta / 快速 SBC / 开包概率 / SBC / GGRating / 进化 / 包内球员 / FG 配置 / 低价 | ❌ 404，上游未发布 |
| `fut.gg/api/fut/player-prices/27/` | 主力价格源 | ⚠️ 命令行测是 403（Cloudflare 拦非浏览器请求），需在浏览器里实测 |
| `futbin.org/futbin/api/27/*` | 价格 / SBC 阵容 / 球员 ID | ⚠️ 待实测 |
| `enhancer-api.futnext.com` | 备用价格源（路径不含赛季号） | ⚠️ 待实测 |

fut.to 不可用时，依赖它的功能（模拟开包概率、快速 SBC 方案、meta 评分、FG 评分、特殊品质、低价查询）会静默失效，但容错层保证不会影响其他功能。
如果你打算自建数据源，`GM_setValue("apibase", "https://你的域名")` 即可整体换源，不用改代码 —— JSON 结构照 `fsu.js:348-570` 的解析逻辑对齐。

### 3.3 第 4 层：写死的游戏数据常量

**已查明：这些值全部由服务器下发，不在公开 bundle 里**，所以静态比对帮不上忙，必须登录态核对。
具体证据：

- `PlayerTrait` 枚举在 bundle 里只有使用、没有数值定义 —— 数值来自 `repositories.PlayStyle`，登录后由 API 填充
- 阵型清单（`f433` 之类的标识）在 bundle 里一个都搜不到 —— 同样是服务器数据
- 联赛 ID（2118 Icons、1003/1014）属于球员数据，天然服务器侧

核对办法：登录 FC27 web app 后在控制台执行

```js
// PlayStyle ID 段（对应 fsu.js:15120 的 _.range(250,269) / _.range(269,274)）
copy(JSON.stringify(Object.keys(repositories.PlayStyle._collection || {})));
// 阵型清单（对应 info.formation）
copy(JSON.stringify(factories.DataProvider.getFormationDP?.().map(f => f.id)));
```

待核对清单：

| 位置 | 内容 | 风险 |
|---|---|---|
| `fsu.js:15120` | `_.range(250,269)` 场上球员 PlayStyle ID 段、`_.range(269,274)` 门将段 | 高 —— FC27 若新增 PlayStyle，ID 段整体位移 |
| `fsu.js:10983` | `_.range(250,269)` 同上 | 高 |
| `fsu.js:123` | `info.chemstyle` 化学风格加成表（键 250-273） | 高 —— 与上面的 ID 段联动 |
| `fsu.js:15134` | `isLegend = 2118 === leagueId`（Icons 联赛 ID） | 中 |
| `fsu.js:832-942` | `leagueId == 1003 / 1014`（特殊球员联赛 ID） | 中 |
| `fsu.js:91` | `info.formation` 阵型→位置映射（30 个阵型） | 中 —— FC27 新增阵型则缺项 |
| `fsu.js:85` | `info.league` 联赛中文名映射 | 低 —— 只影响显示 |
| `fsu.js:7847` | `shield_league` 默认 `[31,16,13,19,53]`（五大联赛） | 低 |
| `fsu.js:233` / `fsu.js:75` | `posIdToName`、`bodytypetext` | 低 |

---

## 四、验证顺序建议

1. `node --check fsu.js` —— 已通过
2. 离线 hook 比对 —— 已通过，见 `FC27-HOOK-REPORT.md`
3. 装进 Tampermonkey，打开 FC27 web app，**先看控制台**：
   - 有 `UTAS origin: https://utas...` → 域名捕获成功（兜底域名无法静态核对，只能看这行）
   - 有 `apiPlatform: 1` → fut.gg 价格源可用；`3` → 退到 futnext
   - 有 `ReferenceError` / `TypeError` → 记下来，对照报告定位
4. 6 个完全替换型方法复核 —— 已完成，见 `FC27-REPLACED-REVIEW.md`
5. 登录后一行确认 `typeof new EAIterator([]).add === "function"`
6. 第 4 层常量核对（§3.3 的两条控制台命令）
7. 可选：跑 `tools/fc27-hook-audit.js` 验证 19 个被混淆的 services 成员
8. 实机验证 DOM 依赖 —— 静态比对覆盖不到 fsu 对 EA DOM 结构与 CSS 类名的依赖

## 五、下次换赛季（FC28）怎么做

1. `fsu.js` 第 40 行 `FSU_SEASON_FALLBACK = 28`（只要 `APP_YEAR_SHORT` 还在，其实连这个都不用改）
2. `@version` 改 `28.00`
3. `node tools/gen-audit.js` 重新生成诊断脚本，在 FC28 web app 跑一遍
4. 按 MISSING 清单修 hook

第 1 层和第 2 层不会再有工作量 —— 这是本次迁移的主要收益。

---

## 六、合规提醒

脚本里的自动购买（`events.goToAutoBuy` 等）、批量开包、批量挂拍属于 EA ToS 明令禁止的自动化操作，封号风险真实存在。
信息展示类（卡片信息、meta 评分、SBC 默契计算、价格查询）风险低得多。迁移本身不改变这个判断。
