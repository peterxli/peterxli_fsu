#!/usr/bin/env node
/**
 * Diff fsu.js's dependency manifest against the downloaded FC27 web app bundle.
 *
 * The bundle obfuscates string literals and local variables but leaves every
 * `Class.prototype.method` assignment in plaintext (10k+ of them), so hook
 * survivability can be checked offline — no login, no browser.
 *
 * Prerequisites:
 *   bash tools/fetch-webapp.sh     # downloads reference/webapp/all.js
 *   node tools/gen-audit.js        # writes tools/fsu-deps.json
 *
 * Usage: node tools/static-audit.js
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const BUNDLE = path.join(ROOT, "reference", "webapp", "all.js");
const MANIFEST = path.join(__dirname, "fsu-deps.json");
const REPORT = path.join(ROOT, "FC27-HOOK-REPORT.md");

for (const f of [BUNDLE, MANIFEST]) {
    if (!fs.existsSync(f)) {
        console.error(`缺少 ${path.relative(ROOT, f)}，请先看本文件头部的前置步骤。`);
        process.exit(1);
    }
}

const bundle = fs.readFileSync(BUNDLE, "utf8");
const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
const build = fs.existsSync(path.join(ROOT, "reference", "webapp", "BUILD"))
    ? fs.readFileSync(path.join(ROOT, "reference", "webapp", "BUILD"), "utf8").trim()
    : "unknown";

/** Word-boundary token search — avoids matching `UTItem` inside `UTItemView`. */
const hasToken = (name) => new RegExp(`(^|[^A-Za-z0-9_$])${name}(?![A-Za-z0-9_$])`).test(bundle);
const countLiteral = (s) => bundle.split(s).length - 1;

// ---------------------------------------------------------------- prototypes
// Three verdicts, because a hook on an *inherited* method still works at
// runtime even though `Sub.prototype.Method` never appears in the bundle.
const proto = {
    ok: [], inherited: [], missingMethod: [], missingClass: [],
    replaced: [], added: [],
};

for (const pair of manifest.prototypes) {
    const dot = pair.indexOf(".");
    const cls = pair.slice(0, dot);
    const method = pair.slice(dot + 1);

    // fsu reimplements the method instead of wrapping it.
    if (manifest.prototypeKind?.[pair] === "assign") {
        if (!hasToken(cls)) {
            proto.missingClass.push(pair);
        } else if (countLiteral(`${cls}.prototype.${method}`) > 0) {
            // EA still ships its own implementation — fsu's copy may now be stale.
            proto.replaced.push(pair);
        } else {
            proto.added.push(pair);
        }
        continue;
    }

    if (countLiteral(`${cls}.prototype.${method}`) > 0) {
        proto.ok.push(pair);
    } else if (!hasToken(cls)) {
        proto.missingClass.push(pair);
    } else if (new RegExp(`\\.prototype\\.${method}(?![A-Za-z0-9_$])`).test(bundle)) {
        // Method exists on some other class — most likely inherited by this one.
        const owners = [
            ...new Set(
                [...bundle.matchAll(
                    new RegExp(`([A-Za-z0-9_$]+)\\.prototype\\.${method}(?![A-Za-z0-9_$])`, "g")
                )].map((m) => m[1])
            ),
        ].slice(0, 4);
        proto.inherited.push(`${pair}   ← 定义在: ${owners.join(", ")}`);
    } else {
        proto.missingMethod.push(pair);
    }
}

// ------------------------------------------------------------------- globals
const globals = { ok: [], missing: [] };
for (const g of [...manifest.globals, ...manifest.lowerGlobals]) {
    (hasToken(g) ? globals.ok : globals.missing).push(g);
}

// -------------------------------------------------------------- repositories
const repos = { ok: [], missing: [] };
for (const r of manifest.repositories) {
    (countLiteral(`repositories.${r}`) > 0 ? repos.ok : repos.missing).push(r);
}

// ------------------------------------------------------------------ services
// Member access is frequently obfuscated to services.X[_0x..(0x1)], so only the
// service name itself is a reliable static signal.
const svcNames = [...new Set(manifest.services.map((s) => s.split(".")[0]))];
const svc = { ok: [], missing: [] };
for (const s of svcNames) {
    (countLiteral(`services.${s}`) > 0 ? svc.ok : svc.missing).push(s);
}
const svcMembers = { ok: [], unverified: [] };
for (const pair of manifest.services) {
    (countLiteral(`services.${pair}`) > 0 ? svcMembers.ok : svcMembers.unverified).push(pair);
}

// -------------------------------------------------------------------- report
// `APP_YEAR=parseInt(window[a0_0x3d(0xad5)],0xa)||0x7eb` — nested parens, so match loosely.
const season = (bundle.match(/APP_YEAR *= *parseInt\(.{0,80}?\|\| *(0x[0-9a-f]+|\d+)/) || [])[1];
const seasonNum = season ? Number(season) - 2000 : null;

const L = [];
L.push("# FSU hook 存活性报告（FC27 静态比对）");
L.push("");
L.push("| 项 | 值 |");
L.push("|---|---|");
L.push(`| 比对日期 | ${new Date().toISOString().slice(0, 10)} |`);
L.push(`| web app build | ${build} |`);
L.push(`| bundle 赛季 | APP_YEAR=${season ?? "?"} → APP_YEAR_SHORT=${seasonNum ?? "?"} |`);
L.push(`| bundle 大小 | ${bundle.length.toLocaleString()} 字节 |`);
L.push(`| 清单来源 | \`${manifest.generatedFrom}\`（${manifest.generatedAt}） |`);
L.push("");
L.push("> 方法：bundle 混淆了字符串与局部变量，但 `Class.prototype.method` 全是明文，");
L.push("> 故可离线逐项字面比对。局限见文末。");
L.push("");
L.push("## 总览");
L.push("");
L.push("| 类别 | 安全 | 需人工确认 | 确定要改 | 总数 |");
L.push("|---|---|---|---|---|");
const wrapTotal = manifest.prototypes.length - proto.replaced.length - proto.added.length;
L.push(`| prototype 包装型 | ${proto.ok.length} | ${proto.inherited.length} | ${proto.missingMethod.length + proto.missingClass.length} | ${wrapTotal} |`);
L.push(`| prototype 完全替换型 | 0 | ${proto.replaced.length} | 0 | ${proto.replaced.length} |`);
L.push(`| prototype 新增型 | ${proto.added.length} | 0 | 0 | ${proto.added.length} |`);
L.push(`| 全局类/枚举 | ${globals.ok.length} | 0 | ${globals.missing.length} | ${globals.ok.length + globals.missing.length} |`);
L.push(`| services 服务名 | ${svc.ok.length} | 0 | ${svc.missing.length} | ${svcNames.length} |`);
L.push(`| services 成员 | ${svcMembers.ok.length} | ${svcMembers.unverified.length}（访问被混淆） | 0 | ${manifest.services.length} |`);
L.push(`| repositories | ${repos.ok.length} | 0 | ${repos.missing.length} | ${manifest.repositories.length} |`);
L.push("");

const section = (title, items, note) => {
    L.push(`## ${title}（${items.length}）`);
    L.push("");
    if (!items.length) {
        L.push("无。");
    } else {
        if (note) { L.push(note); L.push(""); }
        items.forEach((i) => L.push(`- \`${i}\``));
    }
    L.push("");
};

section("❌ 类不存在 —— 功能确定失效", proto.missingClass,
    "这些类在 FC27 bundle 里完全找不到，对应功能必须重写或删除。");
section("❌ 类存在但方法不存在 —— 需改方法名", proto.missingMethod,
    "类还在，方法名变了或被删，需在 bundle 里找替代方法。");
section("⚠️ 完全替换型 —— 需逐个对比 EA 新实现", proto.replaced,
    "fsu 对这些方法是**整体重写、不调用原方法**，而 EA 自己仍有同名实现。" +
    "符号存在不代表安全：EA 在 FC27 改了内部逻辑的话，fsu 的替换版就是过时实现，" +
    "表现为功能看似正常但行为与官方不一致。这是本报告里优先级最高的人工复核项。" +
    "对比方法：`grep -ohE \"类名\\.prototype\\.方法名=function.{0,800}\" reference/webapp/all.js`");
section("➕ 新增型（EA 没有该方法）", proto.added,
    "fsu 自己往 EA 类上加的方法，EA 无同名实现属正常，只要宿主类还在就能挂。");
section("⚠️ 方法定义在父类 —— 大概率可用", proto.inherited,
    "fsu 的覆写模式 `const o = C.prototype.M; C.prototype.M = ...` 对继承方法同样生效，" +
    "但要确认父类实现是否符合预期。");
section("❌ 全局类/枚举缺失", globals.missing);
section("❌ services 服务缺失", svc.missing);
section("❌ repositories 缺失", repos.missing);
section("⚠️ services 成员无法静态确认", svcMembers.unverified,
    "bundle 把这些成员访问混淆成 `services.X[_0x..(0x1)]`，静态查不到不代表不存在。" +
    "这些服务方法本身多为 `UTxxxService.prototype.*`，优先看上面的 prototype 结论。");

L.push("## 方法局限");
L.push("");
L.push("1. **只能证伪，不能完全证实** —— 字面匹配到 `C.prototype.M` 说明符号在，但不保证签名、参数、调用时机没变。");
L.push("2. **行为变更查不出来** —— EA 改了方法内部逻辑或 DOM 结构，静态比对看不见，仍需实机验证。");
L.push("3. **services 成员有盲区** —— 见上节。");
L.push("4. **第 4 层游戏常量不在本报告范围** —— PlayStyle ID 段、化学风格表等见 `MIGRATION-FC27.md` §3.3。");
L.push("");
L.push("重跑：`bash tools/fetch-webapp.sh && node tools/gen-audit.js && node tools/static-audit.js`");

fs.writeFileSync(REPORT, L.join("\n") + "\n", "utf8");

console.log(`web app build ${build}，bundle 赛季 APP_YEAR_SHORT=${seasonNum}`);
console.log(`prototype  包装安全 ${proto.ok.length} / 完全替换 ${proto.replaced.length} / 新增 ${proto.added.length} / 继承 ${proto.inherited.length} / 缺方法 ${proto.missingMethod.length} / 缺类 ${proto.missingClass.length}`);
console.log(`全局符号   在 ${globals.ok.length} / 缺 ${globals.missing.length}`);
console.log(`services   服务在 ${svc.ok.length} / 缺 ${svc.missing.length}；成员可查 ${svcMembers.ok.length} / 混淆 ${svcMembers.unverified.length}`);
console.log(`repos      在 ${repos.ok.length} / 缺 ${repos.missing.length}`);
console.log(`\n报告已写入 ${path.relative(process.cwd(), REPORT)}`);
