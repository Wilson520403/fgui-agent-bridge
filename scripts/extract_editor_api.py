#!/usr/bin/env python3
"""提取 FairyGUI Editor 暴露给 JS 插件的完整 API 清单。

FairyGUI Editor 通过 Puerts 把内部 C# API 绑定给插件 JS，并把绑定结果以
TypeScript 声明文件的形式明文放在编辑器包内：

    Contents/Resources/Data/StreamingAssets/Scripts/Puerts/editor.d.ts

该文件是扩展 fgui-agent-bridge 能力时最权威的接口依据——比反汇编
GameAssembly.dylib（AOT 机器码）信息价值高得多。

用法:
    python3 scripts/extract_editor_api.py
    python3 scripts/extract_editor_api.py ~/Downloads/FairyGUI-Editor.app --out api.json
    python3 scripts/extract_editor_api.py --list-untouched ../plugin/main.ts

输出 JSON 结构:
    {"<namespace>": {"__classes__": {"<Name>": {"kind", "line", "methods": [[k,n,sig], ...]}},
                     "__members__": [...]}}
    methods 中 k 为 "m"（方法/属性访问器）或 "p"（字段/属性）。
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path

DECL_REL = Path("Contents/Resources/Data/StreamingAssets/Scripts/Puerts/editor.d.ts")

# editor.d.ts 用缩进表达命名空间嵌套：每 4 空格一层。
# 4 空格 = 顶层命名空间，8 空格 = 其下的类/接口/枚举或子命名空间，
# 再深一层就是嵌套子命名空间（例如 FairyEditor.View）。
NS_RE = re.compile(r"^( *)namespace ([\w.$]+)")
CLS_RE = re.compile(r"^( *)(class|interface|enum) ([\w$]+)")
# 成员行：修饰符可叠加（public static / public static get ...），
# 必须用可重复的前缀组——单个可选前缀会在 "public static X" 上把 "static"
# 当成成员名，导致后续所有 static 成员被静默丢弃。
MEMBER_RE = re.compile(
    r"^[ \t]*(?P<mods>(?:(?:public|static|get|set|readonly|override|virtual|new)[ \t]+)*)"
    r"(?P<name>[\w$]+)[ \t]*"
    r"(?P<params>\((?P<args>[^)]*)\))?"
    r"[ \t]*(?::[ \t]*(?P<ret>.+))?$"
)

# 类型名在 TypeScript 源码中通常是 PascalCase 标识符
IDENT_RE = re.compile(r"\b([A-Z][A-Za-z0-9_]{2,})\b")


def find_decl(app: Path) -> Path:
    path = app / DECL_REL
    if not path.is_file():
        raise SystemExit(
            f"未找到声明文件：{path}\n"
            f"请确认 FairyGUI Editor 已安装，且 {app} 是正确的 .app 路径。"
        )
    return path


def parse(decl: Path) -> dict:
    """解析 editor.d.ts 为 {namespace: {class: {kind, line, methods}}}。

    命名空间按缩进嵌套还原完整限定名（例如 FairyEditor 下的 FairyEditor.View）。
    声明文件本身已经把点号写进了名字里，这里以缩进为准做深度校验与拼接。
    """
    out: dict[str, dict] = {}
    ns_stack: list[tuple[int, str]] = []
    cur_ns: str | None = None
    cur_cls: str | None = None

    lines = decl.read_text(encoding="utf-8-sig").splitlines()

    for lineno, line in enumerate(lines, 1):
        m = NS_RE.match(line)
        if m:
            depth = len(m.group(1)) // 4
            ns_stack = [e for e in ns_stack if e[0] < depth]
            name = m.group(2)
            # 声明里已带完整点号名；按缩进前缀拼接可与之互相校验
            prefix = ".".join(e[1] for e in sorted(ns_stack))
            cur_ns = f"{prefix}.{name}" if prefix and not name.startswith(prefix) else name
            ns_stack.append((depth, name))
            cur_cls = None
            out.setdefault(cur_ns, {"__classes__": {}, "__members__": []})
            continue

        m = CLS_RE.match(line)
        if m and cur_ns:
            cur_cls = m.group(3)
            entry = out[cur_ns]["__classes__"].setdefault(
                cur_cls, {"kind": m.group(2), "line": lineno, "methods": [], "extends": None}
            )
            # 保留继承关系：FComponent extends FObject 等，否则 stub 会把
            # 合法的 (obj as FairyEditor.FComponent) 误判为不可转换。
            ext = re.search(r"\bextends\s+([\w.$]+)", line)
            if ext:
                entry["extends"] = ext.group(1)
            # 枚举体可能写在同一行，也可能另起一行：
            #   enum SearchOption
            #   { TopDirectoryOnly = 0, AllDirectories = 1 }
            if m.group(2) == "enum":
                body = line
                while "}" not in body and lineno < len(lines):
                    lineno += 1
                    body += " " + lines[lineno - 1]
                for name in re.findall(r"([A-Za-z_]\w*)\s*=", body):
                    entry["methods"].append(["p", name, "number", body.strip()])
            continue

        if not (cur_ns and cur_cls):
            continue

        entry = out[cur_ns]["__classes__"][cur_cls]
        m = MEMBER_RE.match(line)
        if not m:
            continue
        # 存完整行而不是提取出的成员名：_emit_members 需要看到 static/get/set
        # 等修饰信息才能还原真实签名，只存方法名会把它们全部丢掉。
        if m.group("params") is not None:
            entry["methods"].append(["m", m.group("name"), "", line.strip()])
        elif m.group("ret"):
            entry["methods"].append(
                ["p", m.group("name"), m.group("ret").strip()[:80], line.strip()]
            )

    return out


def referenced_types(main_ts: Path) -> set[str]:
    """扫描 Bridge 插件源码，收集它实际引用到的类型名。"""
    return set(IDENT_RE.findall(main_ts.read_text(encoding="utf-8")))


# main.ts 里以限定名引用的宿主类型：FairyEditor.X / CS.UnityEngine.X / CS.System.IO.X ...
QUALIFIED_RE = re.compile(
    r"\b(?:CS\.)?((?:FairyEditor|FairyGUI|UnityEngine|System)"
    r"(?:\.[A-Za-z_]\w*)+)"
)

# 保留基本类型以便仍然检查返回值，其余一律擦成 any——
# 既避免把 System.Collections.Generic / System.Reflection 整棵依赖树拖进来，
# 又保留成员名与参数个数这两项最有价值的检查。
SIMPLE_TYPES = {"void", "boolean", "number", "string"}


def _simplify_type(raw: str | None) -> str:
    if not raw:
        return "any"
    token = raw.split("<")[0].split("$")[0].strip()
    return token if token in SIMPLE_TYPES else "any"


def _emit_members(entries: list, indent: str) -> list[str]:
    """把 editor.d.ts 的成员行改写为 stub 可用的签名行。

    entries 为 [kind, name, type, raw_line]，raw_line 才是签名的唯一可靠来源：
    kind 只用来区分方法与字段，静态性、get/set 全部从 raw_line 解析。

    重载处理：同一成员名可能有多条重载（Directory.GetFiles 有 4 个）。
    全部保留会让 stub 迅速膨胀，因此合并为一条：参数个数取各重载的
    最大值，其中前「最小重载参数个数」个设为必填、其余可选。
    这样既能挡住"参数给少了/给多了"，又不会因重载而产生假阳性。
    """
    props: dict[str, list[str]] = {}
    overloads: dict[tuple[bool, str], list[list[bool]]] = {}
    order: list[tuple[bool, str]] = []

    for kind, name, _type, raw in entries:
        m = MEMBER_RE.match(raw)
        if not m:
            continue
        mods = (m.group("mods") or "").split()
        is_static = "static" in mods
        accessor = "get" in mods or "set" in mods
        mname = m.group("name")

        if accessor or kind == "p" or m.group("params") is None:
            key = ("static " if is_static else "") + mname
            if key not in props:
                order.append((is_static, mname))
                props[key] = [f"{indent}{key}: {_simplify_type(m.group('ret') or _type)};"]
            continue

        if (is_static, mname) not in overloads:
            overloads[(is_static, mname)] = []
            order.append((is_static, mname))
        # 逐参数记录是否可选：editor.d.ts 会把可选参数标成 $flag?: number
        flags = [
            bool(re.match(r"\s*\$?\w+\s*\?", a)) for a in (m.group("args") or "").split(",") if a.strip()
        ]
        overloads[(is_static, mname)].append(flags)

    out: list[str] = []
    for is_static, mname in order:
        prefix = "static " if is_static else ""
        if (is_static, mname) in overloads:
            variants = overloads[(is_static, mname)]
            hi = max(len(v) for v in variants)
            params = []
            for i in range(hi):
                # 只有在每个重载里都存在、且都未标 ? 的参数才算必填
                required = all(len(v) > i and not v[i] for v in variants)
                params.append(f"$p{i}: any" if required else f"$p{i}?: any")
            out.append(f"{indent}{prefix}{mname}({', '.join(params)}): any;")
        else:
            out.extend(props[f"{prefix}{mname}"])
    return out


def emit_stub(api: dict, main_ts: Path, out: Path) -> None:
    """为 main.ts 实际用到的宿主类型生成签名准确的精简声明。

    命名空间树用两种节点表示：{"kind": "ns", "children": {...}} 与
    {"kind": "class", "members": [...]}，便于按缩进递归渲染。
    """
    text = main_ts.read_text(encoding="utf-8")
    ns_classes: dict[str, list[str]] = {}

    for qual in QUALIFIED_RE.findall(text):
        parts = qual.split(".")
        # 必须让最后一段**落在类的位置上**：FairyEditor 同时是命名空间（其下有
        # FairyEditor.App 命名空间）和类的宿主，若按"最长命名空间"匹配，
        # FairyEditor.App 会被当成命名空间而丢掉真正的 App 类。
        for end in range(len(parts) - 1, 0, -1):
            ns = ".".join(parts[:end])
            cls_name = parts[end]
            if cls_name in api.get(ns, {}).get("__classes__", {}):
                ns_classes.setdefault(ns, [])
                if cls_name not in ns_classes[ns]:
                    ns_classes[ns].append(cls_name)
                break

    def new_ns() -> dict:
        return {"kind": "ns", "children": {}}

    root = new_ns()
    for ns, names in sorted(ns_classes.items()):
        node = root
        descend = True
        for part in ns.split("."):
            existing = node["children"].get(part)
            if existing is not None and existing.get("kind") != "ns":
                # 同一段路径既是类又是命名空间（如 FairyEditor.VImage 既是类也有同名子命名空间）。
                # 类更具体：命名空间这一支整支跳过，不能把类节点当命名空间往下钻
                # （否则 node["children"] 直接 KeyError——而触发点可能只是源码里的一句注释）。
                descend = False
                break
            node = node["children"].setdefault(part, new_ns())
        if not descend:
            continue
        for name in sorted(names):
            decl = api[ns]["__classes__"][name]
            node["children"][name] = {
                "kind": decl.get("kind", "class"),
                "members": decl["methods"],
                "extends": decl.get("extends"),
            }

    lines = [
        "/**",
        " * FairyGUI Agent Bridge 编译所用的宿主类型声明——**自动生成，请勿手改**。",
        " *",
        " * 由 scripts/extract_editor_api.py 从 FairyGUI Editor 包内的真实声明生成：",
        " *   Contents/Resources/Data/StreamingAssets/Scripts/Puerts/editor.d.ts",
        f" * 只保留 {main_ts.name} 实际引用到的类型；成员名、静态性与参数个数与真实 API 一致，",
        " * 参数与返回类型除基本类型外统一擦成 any，以避免拖入整棵标准库依赖树。",
        " *",
        " * 重新生成（需本机已安装 FairyGUI Editor）：",
        " *   python3 scripts/extract_editor_api.py --emit-stub plugin/main.ts \\",
        " *       --out plugin/types/editor.d.ts",
        " *",
        " * 声明 ≠ 运行时可用：实机仍可能返回空接口（如 FairyEditor.Framework.Gears.IGear）。",
        " * 新增 Action 后仍须按 FGUI-BRIDGE-IMPROVEMENT-PLAN.md 的标准在真机验收。",
        " */",
        "declare namespace CS {",
    ]

    def build(node: dict, depth: int) -> None:
        pad = "    " * depth
        for name in sorted(node["children"]):
            child = node["children"][name]
            if child["kind"] == "ns":
                lines.append(f"{pad}namespace {name} {{")
                build(child, depth + 1)
                lines.append(f"{pad}}}")
                continue
            if child["kind"] == "enum":
                body = ", ".join(m[1] for m in child["members"] if m[0] == "p")
                lines.append(f"{pad}enum {name} {{ {body} }}")
                continue
            ext = f" extends {child['extends']}" if child.get("extends") else ""
            lines.append(f"{pad}class {name}{ext} {{")
            lines.extend(_emit_members(child["members"], pad + "    "))
            lines.append(f"{pad}}}")

    build(root, 1)
    lines.append("}")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    total = sum(len(v) for v in ns_classes.values())
    print(f"已生成 stub {out}：{len(ns_classes)} 个命名空间 / {total} 个类型")


def summarize(api: dict) -> None:
    total_cls = sum(len(v["__classes__"]) for v in api.values())
    total_mem = sum(
        len(c["methods"]) for v in api.values() for c in v["__classes__"].values()
    )
    print(f"命名空间 {len(api)} 个 / 类型 {total_cls} 个 / 成员 {total_mem} 个\n")
    print("FairyEditor 各命名空间类型数：")
    counts = Counter(
        (ns, len(v["__classes__"])) for ns, v in api.items()
        if ns.startswith("FairyEditor")
    )
    for (ns, n), _ in sorted(counts.items(), key=lambda kv: -kv[0][1]):
        print(f"  {n:4d}  {ns}")


def report_untouched(api: dict, main_ts: Path) -> None:
    editor = api.get("FairyEditor", {}).get("__classes__", {})
    used = referenced_types(main_ts)
    touched = sorted(t for t in used if t in editor)
    untouched = sorted(t for t in editor if t not in used)

    print(f"Bridge ({main_ts}) 引用到的 FairyEditor 类型 {len(touched)} 个：")
    print("  " + ", ".join(touched))
    print(f"\n未触及 {len(untouched)} 个（共 {len(editor)} 个）：")
    print("  " + ", ".join(untouched))


def main() -> int:
    default_app = Path.home() / "Downloads" / "FairyGUI-Editor.app"
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("app", nargs="?", type=Path, default=default_app,
                    help="FairyGUI-Editor.app 路径")
    ap.add_argument("--out", type=Path, help="写出完整 JSON 清单")
    ap.add_argument("--list-untouched", type=Path, metavar="MAIN_TS",
                    help="对比 Bridge 插件 main.ts，列出未触及的类型")
    ap.add_argument("--emit-stub", type=Path, metavar="MAIN_TS",
                    help="为 main.ts 实际用到的类型生成签名准确的精简 .d.ts")
    ap.add_argument("--quiet", action="store_true", help="只写文件，不打印摘要")
    args = ap.parse_args()

    decl = find_decl(args.app.expanduser())
    api = parse(decl)

    if args.emit_stub:
        # 不给 --out 时必须落到插件真正使用的声明文件：写到 CWD 的 editor.d.ts
        # 会让人以为"重新生成了"，实际插件仍在用旧声明。
        out = args.out or Path(__file__).resolve().parent.parent / "plugin/types/editor.d.ts"
        emit_stub(api, args.emit_stub.expanduser(), out)
    elif args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(
            json.dumps(api, ensure_ascii=False, indent=1), encoding="utf-8"
        )
        print(f"已写出 {args.out}  <- {decl}")

    if not args.quiet and not args.emit_stub:
        print(f"来源：{decl}\n")
        summarize(api)

    if args.list_untouched:
        print()
        report_untouched(api, args.list_untouched.expanduser())

    return 0


if __name__ == "__main__":
    sys.exit(main())
