#!/usr/bin/env node
/**
 * Extract every EA web-app symbol fsu.js depends on and emit a standalone
 * audit script that can be pasted into the FC27 web app console.
 *
 * Usage: node tools/gen-audit.js [path/to/fsu.js]
 */

const fs = require("fs");
const path = require("path");

const SRC = process.argv[2] || path.join(__dirname, "..", "fsu.js");
const OUT = path.join(__dirname, "fc27-hook-audit.js");

const raw = fs.readFileSync(SRC, "utf8");

/**
 * Strip comments and string literal *text* while keeping `${...}` interpolations,
 * so identifiers in comments / i18n strings / CSS blobs cannot pollute the result.
 */
function stripNonCode(s) {
    let out = "";
    let i = 0;
    const n = s.length;
    // Template literal nesting depth tracked so `${ ... }` content is preserved.
    const tplStack = [];
    while (i < n) {
        const c = s[i];
        const c2 = s[i + 1];
        if (c === "/" && c2 === "/") {
            while (i < n && s[i] !== "\n") i++;
            continue;
        }
        if (c === "/" && c2 === "*") {
            i += 2;
            while (i < n && !(s[i] === "*" && s[i + 1] === "/")) i++;
            i += 2;
            continue;
        }
        if (c === '"' || c === "'") {
            const q = c;
            i++;
            while (i < n && s[i] !== q) {
                if (s[i] === "\\") i++;
                i++;
            }
            i++;
            out += '""';
            continue;
        }
        if (c === "`") {
            i++;
            tplStack.push(true);
            while (i < n && tplStack.length) {
                if (s[i] === "\\") { i += 2; continue; }
                if (s[i] === "`") { i++; tplStack.pop(); break; }
                if (s[i] === "$" && s[i + 1] === "{") {
                    // Keep interpolation contents verbatim.
                    i += 2;
                    let depth = 1;
                    let start = i;
                    while (i < n && depth) {
                        if (s[i] === "{") depth++;
                        else if (s[i] === "}") depth--;
                        if (depth) i++;
                    }
                    out += " " + stripNonCode(s.slice(start, i)) + " ";
                    i++; // closing }
                    continue;
                }
                i++;
            }
            continue;
        }
        out += c;
        i++;
    }
    return out;
}

const body = raw.replace(/^\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==/, "");
const code = stripNonCode(body);

const uniq = (arr) => Array.from(new Set(arr));

// Symbols the browser or the userscript manager provides — never in EA's bundle,
// so auditing them against it only produces noise.
const HOST_PROVIDED = new Set([
    "XMLHttpRequest", "unsafeWindow", "window", "document", "location", "console",
    "localStorage", "sessionStorage", "indexedDB", "navigator", "performance",
]);

// --- 1. Patched prototypes: Class.prototype.method ---------------------------
const prototypes = uniq(
    [...code.matchAll(/\b([A-Z][A-Za-z0-9_$]*)\.prototype\.([A-Za-z0-9_$]+)/g)]
        .map((m) => `${m[1]}.${m[2]}`)
)
    .filter((p) => !HOST_PROVIDED.has(p.slice(0, p.indexOf("."))))
    .sort();

// How fsu attaches to each method, which decides what breaks when EA changes:
//   wrap   — captures the original and calls it (`const o = C.prototype.M; ...o.call()`).
//            Safe as long as the symbol still exists.
//   assign — assigns without ever reading the original, i.e. fsu reimplements the
//            method outright. static-audit.js splits this into "完全替换" (EA has the
//            symbol → fsu's copy may be stale) and "新增" (EA never had it).
const prototypeKind = {};
for (const pair of prototypes) {
    const dot = pair.indexOf(".");
    const re = new RegExp(
        `${pair.slice(0, dot)}\\.prototype\\.${pair.slice(dot + 1)}(?![A-Za-z0-9_$])\\s*(=(?!=))?`,
        "g"
    );
    // A read position (no trailing `=`) means the original is being captured.
    const wraps = [...code.matchAll(re)].some((m) => !m[1]);
    prototypeKind[pair] = wraps ? "wrap" : "assign";
}

// --- 2. services.<Service>.<member> -----------------------------------------
const serviceMembers = uniq(
    [...code.matchAll(/\bservices\.([A-Z][A-Za-z0-9_$]*)\.([A-Za-z0-9_$]+)/g)]
        .map((m) => `${m[1]}.${m[2]}`)
).sort();

// --- 3. repositories.<Repo> -------------------------------------------------
const repositories = uniq(
    [...code.matchAll(/\brepositories\.([A-Z][A-Za-z0-9_$]*)/g)].map((m) => m[1])
).sort();

// --- 4. Bare globals, only where used in a real code position ---------------
const declared = new Set(
    [...code.matchAll(/\b(?:const|let|var|function|class)\s+([A-Za-z0-9_$]+)/g)].map((m) => m[1])
);
// `var a = {}, b = {}, c = {}` only matches its first declarator above — pick up the rest,
// otherwise the script's own namespaces (SBCCount, futbinId, ...) look like EA globals.
for (const m of code.matchAll(/\b(?:const|let|var)\s+([^;\n]+)/g)) {
    for (const part of m[1].split(",")) {
        const id = part.trim().match(/^([A-Za-z0-9_$]+)\s*(=|$)/);
        if (id) declared.add(id[1]);
    }
}
// Function parameters are locals too — `events.setSbcTileText = (SBCTile) => ...` must not
// make SBCTile look like an EA global.
const PARAM_PATTERNS = [
    /\(([^()]*)\)\s*=>/g,                                   // (a, b) => ...
    /\bfunction\s*[A-Za-z0-9_$]*\s*\(([^()]*)\)/g,          // function f(a, b)
    /(?:^|[^.\w$])([A-Za-z0-9_$]+)\s*=>/gm,                 // a => ...
];
for (const re of PARAM_PATTERNS) {
    for (const m of code.matchAll(re)) {
        for (const part of m[1].split(",")) {
            const id = part.replace(/[{}[\]]/g, "").trim().match(/^\.{0,3}([A-Za-z0-9_$]+)/);
            if (id) declared.add(id[1]);
        }
    }
}

const BUILTINS = new Set([
    "Array", "Boolean", "Date", "Error", "Function", "JSON", "Map", "Math", "Number",
    "Object", "Promise", "RegExp", "Set", "String", "Symbol", "WeakMap", "WeakSet",
    "Infinity", "NaN", "Intl", "BigInt", "Proxy", "Reflect",
    "TypeError", "RangeError", "SyntaxError", "ReferenceError",
    "Image", "Blob", "File", "FileReader", "FormData", "Headers", "Request", "Response",
    "XMLHttpRequest", "URL", "URLSearchParams", "MutationObserver", "IntersectionObserver",
    "Node", "Element", "HTMLElement", "Event", "CustomEvent", "DOMParser", "Audio",
    "ArrayBuffer", "Uint8Array", "TextDecoder", "TextEncoder", "IDBKeyRange", "IDBRequest",
    "GM_addStyle", "GM_openInTab", "GM_xmlhttpRequest", "GM_getValue", "GM_setValue", "GM_info",
]);
const CODE_POSITIONS = [
    /\bnew\s+([A-Z][A-Za-z0-9_$]*)/g,            // new UTButtonControl()
    /\binstanceof\s+([A-Z][A-Za-z0-9_$]*)/g,     // x instanceof UTLabelView
    /(?:^|[^.\w$])([A-Z][A-Za-z0-9_$]*)\s*\./gm, // ItemType.PLAYER
    /(?:^|[^.\w$])([A-Z][A-Za-z0-9_$]*)\s*\(/gm, // getAppMain-style calls
];
const globals = uniq(
    CODE_POSITIONS.flatMap((re) => [...code.matchAll(re)].map((m) => m[1]))
)
    .filter((n) => !declared.has(n) && !BUILTINS.has(n) && !HOST_PROVIDED.has(n))
    .sort();

// Lower-case globals the script also relies on.
const LOWER_GLOBALS = ["services", "repositories", "getAppMain", "isPhone", "enums", "unsafeWindow"]
    .filter((n) => !HOST_PROVIDED.has(n))
    .filter((n) => new RegExp(`(^|[^.\\w$])${n}\\b`).test(code));

const manifest = {
    generatedFrom: path.basename(SRC),
    generatedAt: new Date().toISOString().slice(0, 10),
    prototypes,
    prototypeKind,
    services: serviceMembers,
    repositories,
    globals,
    lowerGlobals: LOWER_GLOBALS,
};

const runner = `// ==========================================================================
// FSU FC27 依赖体检脚本  —  由 tools/gen-audit.js 从 ${manifest.generatedFrom} 自动生成
// 生成日期: ${manifest.generatedAt}
//
// 用法：登录 FC27 web app 进到主界面（不是登录页），F12 控制台整段粘贴回车。
// 作用：逐项检查 fsu.js 依赖的 EA 内部类 / 方法 / 服务在 FC27 里是否仍然存在。
//       输出的 MISSING 清单就是需要人工适配的确切范围。
// 本脚本只读，不修改页面任何状态。
// ==========================================================================
(function () {
    "use strict";

    const M = ${JSON.stringify(manifest, null, 4).replace(/\n/g, "\n    ")};

    const W = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
    const KEYS = ["prototypes", "services", "repositories", "globals", "lowerGlobals"];
    const miss = {};
    const ok = {};
    KEYS.forEach((k) => { miss[k] = []; ok[k] = 0; });

    const get = (name) => {
        if (name in W) return W[name];
        try { return W.eval(name); } catch (e) { return undefined; }
    };

    // --- 原型方法 ---
    for (const pair of M.prototypes) {
        const dot = pair.indexOf(".");
        const cls = pair.slice(0, dot);
        const method = pair.slice(dot + 1);
        const C = get(cls);
        if (typeof C !== "function" || !C.prototype) miss.prototypes.push(pair + "   [类不存在]");
        else if (typeof C.prototype[method] !== "function") miss.prototypes.push(pair + "   [方法不存在]");
        else ok.prototypes++;
    }

    // --- services.X.y ---
    const svc = get("services");
    for (const pair of M.services) {
        const [s, m] = pair.split(".");
        if (!svc || !svc[s]) miss.services.push("services." + pair + "   [服务不存在]");
        else if (!(m in svc[s])) miss.services.push("services." + pair + "   [成员不存在]");
        else ok.services++;
    }

    // --- repositories.X ---
    const repo = get("repositories");
    for (const r of M.repositories) {
        if (!repo || !repo[r]) miss.repositories.push("repositories." + r);
        else ok.repositories++;
    }

    // --- 全局类 / 枚举 ---
    for (const key of ["globals", "lowerGlobals"]) {
        for (const g of M[key]) {
            if (typeof get(g) === "undefined") miss[key].push(g);
            else ok[key]++;
        }
    }

    const season = get("APP_YEAR_SHORT");
    console.log("%c=== FSU FC27 依赖体检 ===", "font-weight:bold;font-size:14px");
    console.log("APP_YEAR_SHORT =", season,
        season === undefined ? "⚠️ 取不到赛季号，fsu 将退回兜底值 27" : "");
    console.table(KEYS.map((k) => ({
        类别: k, 通过: ok[k], 缺失: miss[k].length, 总数: M[k].length,
    })));

    let total = 0;
    for (const k of KEYS) {
        total += miss[k].length;
        if (miss[k].length) {
            console.groupCollapsed("%cMISSING / " + k + " (" + miss[k].length + ")",
                "color:#d33;font-weight:bold");
            miss[k].forEach((x) => console.log("  ✗ " + x));
            console.groupEnd();
        }
    }
    if (!total) console.log("%c全部依赖都在，FC27 前端结构与 FC26 兼容。", "color:#2a2;font-weight:bold");

    W.__fsuAudit = miss;
    console.log("%c完整结果已存入 window.__fsuAudit —— 执行 copy(JSON.stringify(__fsuAudit,null,2)) 可复制。",
        "color:#888");
})();
`;

fs.writeFileSync(OUT, runner, "utf8");
// Machine-readable manifest, consumed by static-audit.js.
const MANIFEST = path.join(__dirname, "fsu-deps.json");
fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2), "utf8");
console.log(`已生成 ${path.relative(process.cwd(), OUT)}`);
console.log(`已生成 ${path.relative(process.cwd(), MANIFEST)}`);
console.log(`  prototype 方法: ${prototypes.length}`);
console.log(`  services 成员 : ${serviceMembers.length}`);
console.log(`  repositories  : ${repositories.length}`);
console.log(`  全局符号      : ${globals.length} (+${LOWER_GLOBALS.length} 小写)`);
