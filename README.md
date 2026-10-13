# FSU 增强器 FC27 迁移

把【FSU】EA FC FUT WEB 增强器从 FC26（26.09）迁移到 FC27，并补齐一套可复现的离线校验工具链。

> **原作者**：Futcd_kcka（<https://futcd.com/>），MIT License。
> `fsu.js` 是其 26.09 版的衍生版本，原始许可与版权声明保留在脚本头部。
> `fsu-fc26.js` 是未改动的 26.09 原版，仅作对照留档。

## 文件

| 文件 | 说明 |
|---|---|
| `fsu.js` | 工作文件，v27.00 |
| `fsu-fc26.js` | FC26 原版留档（不要改） |
| `MIGRATION-FC27.md` | 迁移记录：改了什么、为什么、还剩什么 |
| `REQUIREMENTS.md` | 从源码反推的需求规格说明书（约 100 条 FR） |
| `FC27-HOOK-REPORT.md` | hook 存活性报告（工具生成） |
| `FC27-REPLACED-REVIEW.md` | 6 个"完全替换型"方法与 EA 新实现的逐个对比 |
| `FC27-SBC-CHANGE.md` | FC27 新增的 One-Click / Streamlined SBC 形态及其影响 |

## 工具链

EA FC web app 的 JS bundle 是公开的，且 `Class.prototype.method` 全部是明文，
所以 hook 存活性可以**完全离线校验** —— 不需要浏览器，不需要登录。

```bash
bash tools/fetch-webapp.sh     # 下载 bundle 到 reference/webapp/（不入库）
node tools/gen-audit.js        # 从 fsu.js 提取依赖 → tools/fsu-deps.json
node tools/static-audit.js     # 与 bundle 离线比对 → FC27-HOOK-REPORT.md
```

辅助工具：

```bash
node tools/ea-impl.js UTHomeHubView.prototype.getSBCTile   # 抽 EA 某方法的实现
node tools/extract-i18n.js [命名空间]                       # 导出脚本内置 i18n 表
node tools/extract-hooks.js                                 # 导出 hook → 作者注释 映射
```

`tools/fc27-hook-audit.js` 是可选的运行时复查脚本，粘进 web app 控制台执行；
静态比对已覆盖它的绝大部分能力，它的增量价值是验证 19 个被混淆的 services 成员访问。

## 当前状态

| 层 | 状态 |
|---|---|
| 赛季号 / URL / 存储键 | ✅ 已统一到适配层，下赛季改一个常量 |
| 远端数据缺失容错 | ✅ 已补 |
| EA 前端 hook（107 处） | ✅ 离线比对无缺失；查出并修复 2 个真实破坏 |
| 游戏数据常量 | ⏳ 服务器下发，需登录态核对 |
| One-Click SBC 支持 | ⏳ 已做 3 处止损改动，完整支持是独立新功能 |

详见 `MIGRATION-FC27.md`。

## 合规提醒

脚本中的快速 SBC、批量开包、批量挂牌属于 EA ToS 禁止的自动化操作，封号风险真实存在。
信息展示类功能风险低得多。详见 `REQUIREMENTS.md` 第 8 节。
