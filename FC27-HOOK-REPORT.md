# FSU hook 存活性报告（FC27 静态比对）

| 项 | 值 |
|---|---|
| 比对日期 | 2026-10-13 |
| web app build | 11414 |
| bundle 赛季 | APP_YEAR=0x7eb → APP_YEAR_SHORT=27 |
| bundle 大小 | 5,410,200 字节 |
| 清单来源 | `fsu.js`（2026-10-13） |

> 方法：bundle 混淆了字符串与局部变量，但 `Class.prototype.method` 全是明文，
> 故可离线逐项字面比对。局限见文末。

## 总览

| 类别 | 安全 | 需人工确认 | 确定要改 | 总数 |
|---|---|---|---|---|
| prototype 包装型 | 100 | 0 | 0 | 100 |
| prototype 完全替换型 | 0 | 6 | 0 | 6 |
| prototype 新增型 | 2 | 0 | 0 | 2 |
| 全局类/枚举 | 168 | 0 | 0 | 168 |
| services 服务名 | 17 | 0 | 0 | 17 |
| services 成员 | 32 | 19（访问被混淆） | 0 | 51 |
| repositories | 7 | 0 | 0 | 7 |

## ❌ 类不存在 —— 功能确定失效（0）

无。

## ❌ 类存在但方法不存在 —— 需改方法名（0）

无。

## ⚠️ 完全替换型 —— 需逐个对比 EA 新实现（6）

fsu 对这些方法是**整体重写、不调用原方法**，而 EA 自己仍有同名实现。符号存在不代表安全：EA 在 FC27 改了内部逻辑的话，fsu 的替换版就是过时实现，表现为功能看似正常但行为与官方不一致。这是本报告里优先级最高的人工复核项。对比方法：`grep -ohE "类名\.prototype\.方法名=function.{0,800}" reference/webapp/all.js`

- `UTHomeHubView.getAcademyTile`
- `UTHomeHubView.getObjectivesTile`
- `UTHomeHubView.getSBCTile`
- `UTPackAnimationViewController.runAnimation`
- `UTSBCSetsViewModel.getCategories`
- `UTSquadBuilderViewModel.generatePlayerCollection`

## ➕ 新增型（EA 没有该方法）（2）

fsu 自己往 EA 类上加的方法，EA 无同名实现属正常，只要宿主类还在就能挂。

- `UTItemDetailsNavigationController.setSquadContext`
- `UTSBCService.loadChallengeData`

## ⚠️ 方法定义在父类 —— 大概率可用（0）

无。

## ❌ 全局类/枚举缺失（0）

无。

## ❌ services 服务缺失（0）

无。

## ❌ repositories 缺失（0）

无。

## ⚠️ services 成员无法静态确认（19）

bundle 把这些成员访问混淆成 `services.X[_0x..(0x1)]`，静态查不到不代表不存在。这些服务方法本身多为 `UTxxxService.prototype.*`，优先看上面的 prototype 结论。

- `Academy.requestAcademyHub`
- `Academy.requestSlotsByCategory`
- `Authentication.utasSession`
- `Club.clubDao`
- `Configuration.serverSettings`
- `Item.itemDao`
- `Item.marketRepository`
- `Localization.repository`
- `Messages.messagesRepository`
- `Objectives.objectivesDAO`
- `PlayerMetaData.metaDAO`
- `SBC.loadChallengeData`
- `SBC.repository`
- `SBC.sbcDAO`
- `Squad.activeSquad`
- `Squad.getTacticRoles`
- `Squad.squadDao`
- `Store.storeDao`
- `User.maxAllowedAuctions`

## 方法局限

1. **只能证伪，不能完全证实** —— 字面匹配到 `C.prototype.M` 说明符号在，但不保证签名、参数、调用时机没变。
2. **行为变更查不出来** —— EA 改了方法内部逻辑或 DOM 结构，静态比对看不见，仍需实机验证。
3. **services 成员有盲区** —— 见上节。
4. **第 4 层游戏常量不在本报告范围** —— PlayStyle ID 段、化学风格表等见 `MIGRATION-FC27.md` §3.3。

重跑：`bash tools/fetch-webapp.sh && node tools/gen-audit.js && node tools/static-audit.js`
