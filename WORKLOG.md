# 工作日志

**新条目加在最前面。** 每次有实质改动都要追加，格式见下方模板。
这是跨会话的记忆载体 —— 新会话从读顶部一条开始。

<details>
<summary>条目模板（点开复制）</summary>

```markdown
## YYYY-MM-DD 一句话标题

**做了什么**

- 改动点，带 `文件:行号`

**为什么**

- 触发原因 / 要解决的问题

**关键决策**

- 做了什么取舍，以及放弃了哪些方案、理由

**验证**

- 跑了什么、结果如何

**遗留**

- 没做完的、需要下次接手的
```

</details>

---

## 2026-10-13 FC26 → FC27 迁移，建仓上 GitHub

本次会话从零开始，完成整个迁移。基线是上游 26.09 原版（`fsu-fc26.js`，未改动）。

**做了什么**

1. **赛季适配层**（`fsu.js:39-61`）—— 把散落的赛季硬编码收成一处：
   `fsuSeason()` / `fsuApi()` / `fsuKey()` / `fsuUtas()`。替换 31 处：
   12 个 fut.to 接口、2 个 fut.gg 价格路径、1 个 utas `fc26`、15 个 GM 存储键、`info.base.year`
2. **UTAS 域名改运行时捕获**（`fsu.js:15530` 的 XHR 拦截里顺手抓），不再写死主机名
3. **跨赛季缓存隔离** —— `futbinId`/`sbclist`/`ggr`/`history`/`academy`/`lock`/`playerMetaData`
   按赛季分键；`set`/`build`/`apiproxy`/`packsSort` 保持不分赛季（用户配置应跨赛季复用）
4. **容错**：`info.specialPlayers` / `info.playermeta` 预置空结构，`info.GGRRAR` 三处改可选链
5. **修复 `NetworkErrorManager` 移除**（`fsu.js:59` + 12 处调用点）
6. **修复 `generatePlayerCollection` 崩溃**（`fsu.js:7638-7646`）
7. **One-Click SBC 三处止损**：需求视图加判定（`13798`）、SBC 计数覆盖新提交路径（`11850-11886`）、
   子任务行加 FUTBIN 数据缺失保护（`5261`）
8. **工具链**：`fetch-webapp.sh` / `gen-audit.js` / `static-audit.js` / `ea-impl.js` /
   `extract-i18n.js` / `extract-hooks.js`
9. **文档**：`REQUIREMENTS.md`（源码反推需求规格）、`MIGRATION-FC27.md`、
   `FC27-SBC-CHANGE.md`、`FC27-REPLACED-REVIEW.md`
10. **建仓推 GitHub**：`git@github.com:peterxli/peterxli_fsu.git`，仓库级个人身份

**为什么**

FC27 已上线（bundle 确认 `APP_YEAR_SHORT=27`），26.09 的硬编码赛季号全部失效。

**关键决策**

- **不用浏览器做 hook 校验，改用离线静态比对。**
  关键发现：EA web app bundle 公开可下载，5.4MB 里只有引导层 `ocompiled.js` 做了字符串混淆，
  **1 万多处 `Class.prototype.method` 全是明文**。所以不需要登录、不需要浏览器就能逐项比对。
  这条路比原计划的"控制台粘贴脚本"更准，还能区分包装/替换/新增三类 hook
- **hook 分三类而不是两类。** 最初把"不调原方法"的归为低风险"新增型"，核验后发现判反了 ——
  其中 6 个 EA 自己仍有同名实现，属**完全替换**，风险比包装型更高（符号在但实现可能过时）
- **放弃"tile 改显示 scoreRequirement"**。深挖后发现 EA 自己已经渲染了
  `submittedScore/scoreRequirement`，再加一遍是重复；且 FUTBIN 对 Streamlined SBC 有成本估算，
  造价预估对 One-Click 并非无意义。改为修真正的风险点：FUTBIN 数据缺失时的 TypeError
- **不解混淆字符串数组**。`EAIterator.add` 的验证需要执行 RC4+base64 混淆代码，不在本机跑，
  留作登录后一行确认
- **`reference/webapp/` 不入库**。EA 专有代码，10MB，可脚本重拉

**验证**

- `node --check` 全过（`fsu.js` + 6 个工具脚本）
- 离线审计：prototype 包装型 **100/100 安全**，完全替换型 6（已逐个人工复核），
  新增型 2，全局符号 168/168，services 17/17，repositories 7/7，**缺失 0**
- 相对 FC26 原版累计改动 211 行

**遗留**

- **从未实机验证** —— 整个迁移没在登录态跑过一次，这是最大未知。
  静态比对覆盖不到 DOM 结构与 CSS 类名依赖，最可能的失败模式是界面错位而非报错
- 登录后两条命令可清掉剩余待确认项：
  ```js
  typeof new EAIterator([]).add                                        // 期望 "function"
  copy(JSON.stringify(Object.keys(repositories.PlayStyle._collection))) // PlayStyle ID 段
  ```
- 游戏数据常量（PlayStyle ID 段、阵型表、联赛 ID）确认为服务器下发，公开 bundle 里没有
- **One-Click SBC 完整支持未开工** —— 按俱乐部库存解最优卡组合（带数量上限的背包问题），
  挂 `UTOneClickSBCWorkAreaViewController`。fsu 比 FUTBIN 有优势：能读到实际持有的卡
- `api.fut.to/27` 仍 404，依赖它的功能处于休眠
