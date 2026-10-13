# CLAUDE.md

本文件每次会话自动加载。**开工前先读 `WORKLOG.md` 顶部一条**，了解上次做到哪。

## 这是什么

把【FSU】EA FC FUT WEB 增强器（原作者 Futcd_kcka，MIT）从 FC26 迁移到 FC27 并持续维护。
`fsu.js` 是单文件油猴脚本，约 15.8k 行，单一 IIFE，无构建系统。

## 铁律

1. **`fsu-fc26.js` 只读** —— FC26 原版留档，用于对照，任何情况下不要修改
2. **`reference/webapp/` 不入库** —— EA 专有 bundle，已 gitignore；需要时 `bash tools/fetch-webapp.sh` 重拉
3. **git 身份用仓库级个人配置**（`peterxli <peterxli354@gmail.com>`），全局是公司邮箱，**不要用**
4. **提交/推送前先问**（用户全局规范），commit message 用英文
5. 改完 `fsu.js` 必须 `node --check fsu.js`，没有测试套件，这是唯一的自动验证

## 改动后的必做项

```bash
node --check fsu.js                              # 1. 语法
node tools/gen-audit.js && node tools/static-audit.js   # 2. 依赖未失效（需先拉 bundle）
```

然后**在 `WORKLOG.md` 顶部追加一条**：日期、做了什么、为什么、关键决策、验证结果。
这是本仓库的记忆机制，不要省略。

## 架构约束（改代码前必须知道）

- **所有 UI 增强靠覆写 EA 内部类原型**，模式必须是"先调原方法，再做增强"
- hook 分三类，风险递增：
  - **包装型**：捕获原方法并调用 → 符号在就安全（当前 100 处）
  - **完全替换型**：不调原方法、整体重写 → **EA 改实现就会行为不一致**（当前 6 处，见 `FC27-REPLACED-REVIEW.md`）
  - **新增型**：EA 没有该方法 → 只要宿主类在（当前 2 处）
- 赛季相关的 URL / 存储键一律走 `fsu.js:39-61` 的适配层（`fsuSeason` / `fsuApi` / `fsuKey` / `fsuUtas`），不要新增硬编码
- 新增用户可见文案必须三语齐备（简/繁/英），加到 `info.localization`

## 踩过的坑（别再踩）

- **`perl -pi` 会吃掉 JS 模板字符串里的 `${...}`**（当成 perl 变量）。改含 `${}` 的代码用 Edit 工具，不要用 perl
- **`info.fgconfig` 不能预置默认值** —— `events.fgCalc` 用 `_.has(info,"fgconfig")` 判断功能可用性，预置了反而会带着空配置跑崩
- **不要执行 `ocompiled.js`** 去解混淆字符串数组（RC4+base64）。那是第三方混淆代码，不在本机跑
- **全局 `~/.gitignore_global` 忽略了 `.gitignore` 本身**，本仓库的 `.gitignore` 是 `-f` 强制加入的
- bundle 里 `Class.prototype.method` 全是明文，**hook 校验完全可离线做**，不需要浏览器和账号

## 当前状态

| 项 | 状态 |
|---|---|
| 赛季号 / URL / 存储键适配 | ✅ 完成 |
| 远端数据缺失容错 | ✅ 完成 |
| EA 前端 hook 校验 | ✅ 离线比对无缺失 |
| One-Click SBC 止损 | ✅ 3 处已做 |
| **实机验证** | ❌ **从未在登录态跑过，这是最大的未知** |
| 游戏数据常量（PlayStyle ID 段等） | ⏳ 服务器下发，需登录态 |
| One-Click SBC 完整支持 | ⏳ 独立新功能，未开工 |

## 已知外部状况

- **`api.fut.to/27/*.json` 全部 404** —— 上游作者未发布 FC27 数据源。
  依赖它的功能（开包概率、快速 SBC、meta 评分、FG 评分、特殊品质、低价查询）静默失效，
  **这是预期行为不是 bug**。可用 `GM_setValue("apibase", "https://自建域名")` 换源
- `fut.gg` / `futbin.org` / `futnext` 接口在 FC27 是否可用**未验证**（浏览器内测 CORS 会挡，
  fsu 用 `GM_xmlhttpRequest` 绕开，只能装进篡改猴实测）

## 文档索引

| 文件 | 内容 |
|---|---|
| `WORKLOG.md` | **改动历史，每次开工先读顶部** |
| `MIGRATION-FC27.md` | 迁移全记录：改了什么、为什么、还剩什么 |
| `REQUIREMENTS.md` | 源码反推的需求规格（约 100 条 FR）+ 已知缺陷/死代码 |
| `FC27-SBC-CHANGE.md` | FC27 新增的 One-Click SBC 形态及影响 |
| `FC27-REPLACED-REVIEW.md` | 6 个完全替换型方法与 EA 新实现的逐个对比 |
| `FC27-HOOK-REPORT.md` | hook 存活性报告（`static-audit.js` 生成，勿手改） |

## 工具链

```bash
bash tools/fetch-webapp.sh          # 拉 EA bundle 到 reference/webapp/
node tools/gen-audit.js             # 提取 fsu 依赖 → tools/fsu-deps.json
node tools/static-audit.js          # 离线比对 → FC27-HOOK-REPORT.md
node tools/ea-impl.js <Class>.prototype.<method>   # 抽 EA 某方法实现
node tools/extract-i18n.js [命名空间]              # 导出 i18n 表
node tools/extract-hooks.js                        # 导出 hook → 注释映射
```
