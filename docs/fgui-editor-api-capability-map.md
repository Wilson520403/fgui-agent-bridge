# FairyGUI Editor 6.1.4 逆向分析 → Bridge 能力增强清单

> 分析日期：2026-10-19
> 目标：`~/Downloads/FairyGUI-Editor.app`（v6.1.4，Unity build `8586c82ced4c`）
> 目的：为 `fgui-agent-bridge` 找出编辑器已具备但 Bridge 尚未暴露的能力
> 配套脚本：`scripts/extract_editor_api.py`（可重复生成完整清单）

---

## 0. 结论先行

**编辑器不是黑盒。** FairyGUI Editor 通过 Puerts 把**几乎全部内部 C# API**暴露给了 JS 插件，
并且把这份绑定**以 TypeScript 声明文件的形式明文放在编辑器包内**：

```
Contents/Resources/Data/StreamingAssets/Scripts/Puerts/editor.d.ts
  21708 行 / 1.37 MB
  FairyEditor.* 命名空间合计：184 个类型 / 2222 个成员
    ├─ FairyEditor          150 类（FPackage / FComponent / DependencyQuery / 设置对象…）
    └─ FairyEditor.View      34 类（Document / DocElement / TestView / MainMenu / ActionHistory…）
  FairyGUI 运行时命名空间：172 个类
  另有 UnityEngine 191 类、System.* 等标准程序集
```

**Bridge 目前只用到其中 21 个类型**（`plugin/main.ts` 实际引用的 FairyEditor 根命名空间类型），
其余 129 个类型完全未触及（根命名空间共 150 类）。计划文档里"尚未实现"的条目，多数并不需要新造轮子——
编辑器原生就有对应入口，只是 Bridge 没调用。

一个额外的高价值发现：**编辑器原生 UI 里带预览/测试运行时**（`FairyEditor.View.TestView`）和
**离屏渲染截图能力**（`FairyGUI.CaptureCamera.Capture`），Phase 5 的"预览后导出指定帧截图"
不需要截屏整个应用窗口，可以直接渲染指定 display object。

> 命名空间归属提醒：`Document` / `DocElement` / `TestView` / `MainMenu` / `ActionHistory`
> 等在 `FairyEditor.**View**` 下，不在 `FairyEditor` 根下。写类型标注时用完整限定名。

---

## 1. 编辑器内部结构（观察）

| 层 | 证据 | 说明 |
| --- | --- | --- |
| IL2CPP 原生层 | `Frameworks/GameAssembly.dylib`（104 MB）、`UnityPlayer.dylib`（55 MB）、`Resources/Data/il2cpp_data/Metadata/global-metadata.dat` | 用户 C# 全部 AOT 编译进 `GameAssembly.dylib` |
| 启动壳 | `MacOS/FairyGUI-Editor`，151 KB，Mach-O universal（x86_64 + arm64） | Unity 播放器引导桩，本身几乎无业务逻辑 |
| JS 绑定层 | `PlugIns/puerts.bundle`（40 MB）+ `StreamingAssets/Scripts/Puerts/` | Puerts，V8 承载插件 JS |
| Lua 绑定层 | `PlugIns/xlua.bundle` + `StreamingAssets/Scripts/*.lua` | XLua，内置代码生成器（`Main.lua` 按 `ProjectType` 分派） |
| 资源 | `Resources/Data/resources.assets`（612 KB + 14 MB resS）等 | 图集、UI 包等 |

### 关键推论（推断）

`GameAssembly.dylib` 里是 AOT 机器码，**不适合逆向**；但 `editor.d.ts` 已经是
Puerts 官方生成的**权威接口清单**，包含了类型名、成员名、参数类型和返回类型。
对"扩展 Bridge 能力"这个目标而言，`editor.d.ts` 的信息价值**远高于**反汇编 AOT 代码。

---

## 2. 证据获取方式与边界

### 能做到的

| 手段 | 结果 |
| --- | --- |
| `scripts/extract_editor_api.py` 解析 `editor.d.ts` | ✅ 184 类 / 2222 成员结构化清单 |
| REA `inspect-macho`（Evidence `ev_d79b70ed05bf1027…`） | ✅ Mach-O 头、双架构切片、load commands |
| REA `trace-dylib-resolution`（Evidence `ev_f9ef27ab5fb0d6fc…`） | ✅ 全部 image 的 install_name / rpath / 签名状态 |
| 读取 `Info.plist` / `boot.config` / `ScriptingAssemblies.json` | ✅ 版本、构建号、依赖程序集 |

### 做不到的（明确边界）

**REA 的原生反编译链路在本机不可用**，三条 provider 全部被拒：

- `ghidra` — 未配置；`GHIDRA_INSTALL_DIR` 未设置，且本机 Java 为 **11.0.31**，REA 要求 **JDK 21+**
- `hopper` — `/Applications/Hopper Disassembler.app/Contents/MacOS/hopper` 不存在
- `ida` — `REA_IDA_MCP_CONFIG` 未配置

`rea analyze` 返回 `provider_unavailable`。REA 的安装流程明确不负责安装 Ghidra/Hopper/IDA，
所以这是环境边界而非配置错误。**本报告全部结论不依赖原生反编译**，因此不受影响。

### 尚未验证的（未知）

- 清单来自**声明**，不是运行时观测。个别 API 虽在 `editor.d.ts` 中声明，
  是否在 6.1.4 运行时真实可用（例如返回空接口）需实机验证——
  计划文档里 `GetGear` 返回空 `IGear` 就是现成的反例。
- 未做跨版本对比（仅有 6.1.4 一个样本）。升级编辑器后需重新提取。

---

## 3. 能力差集：Bridge 用到的 vs 可用的

`plugin/main.ts` 实际引用的 FairyEditor 根命名空间类型（21 个，2026-10-19 更新）：

```
AniData, App, ComponentTemplates, DepItem, DependencyQuery, FComponent,
FController, FGroup, FList, FObject, FObjectType, FPackage, FPackageItem,
FPackageItemType, FRelations, FTransition, FTransitionItem,
GlobalPublishSettings, PluginManager, PublishHandler, ReferenceInfo
```

（`Document` / `DocElement` 在 `FairyEditor.View` 下，不计入上面的根命名空间统计。）
其中 `DepItem` / `DependencyQuery` / `ReferenceInfo` 是 0.8.10 的 P8-2 只读引用图引入的。

已实现 49 个 action（`ping` / `get_project` / `list_packages` / `list_items` /
`open_document` / `create_component` / `import_image` / `import_font` / `create_button` /
`get_active_document` / `get_tree` / `select_object` / `import_sound` / `create_movieclip` /
`get_movieclip` / `update_movieclip` / `remove_movieclip` / `list_transitions` /
`get_transition` / `upsert_transition` / `remove_transition` / `add_transition_item` /
`update_transition_item` / `remove_transition_item` / `preview_animation` /
`replace_object_resource` / `get_text_style` / `set_text_style` / `verify_document` /
`set_list_layout` / `set_group_layout` / `set_relation` / `set_gear_display` /
`set_controller` / `list_controllers` / `set_property` / `insert_object` /
`remove_object` / `save_document` / `save_all` / `get_publish_settings` / `publish` /
`get_history` / `discard_document` / `undo` / `redo`）。

未触及且高价值的类型（节选 66 个）：`FullSearch`、`ImportStringsHandler`、
`ExportStringsHandler`、`XMLExtension`、`PackSettings`、`AtlasSettings`、`I18nSettings`、
`AdaptationSettings`、`PackageGroupSettings`、`ActionHistory`、`ObjectSnapshot`、
`PreviewView`、`TestView`、`ReferenceView`、`FTree`、`MainMenu`、
`FTextField` / `FRichTextField` / `FTextInput` 的完整样式面、`CustomProps` / `ComProperty`、
以及全部 `FButton` / `FComboBox` / `FSlider` / `FProgressBar` / `FScrollPane` 的组件级成员。

> `FindDuplicateResource` / `FindUnusedResource` / `AssetSizeUtil` / `BuilderUtil` 已于
> 0.8.19 经免授权路径触及（原生审计入口是 Pro 功能，不直接调用）；`DependencyQuery` /
> `ReferenceInfo` / `DepItem` 已于 0.8.10 被 `query_references` /
> `query_dependencies` 触及，**但下面的真机结论比声明可靠得多，实现 `replace_references`
> 前必读**：

### ReferenceInfo 的真实形态（Editor 6.1.4 实测，证据 `tests/reports/p8-2-live.json`）

```text
QueryReferences(project, url).references → ReferenceInfo[]
  ownerPkg / pkgId / itemId   指的是「被引用的那个资源」，不是引用它的组件
  propKey / arrayIndex / valueType
  content                     FairyGUI.Utils.XML 元素节点 ← 真正的答案在这里
    content.name              元素标签（component / list / image / loader）
    content.attributes        C# 字典：JSON.stringify 得 {}，Keys.get_Item 不存在，
                              只能用 GetEnumerator() + MoveNext() + Current
    content.attributes.id     宿主对象 id（形如 n3_fix01）
    content.attributes.name   宿主对象名（如 btnMain）
XML.ToXMLString()             抛 "overload is stripped by unity"，不可用
```

所以「谁引用了它」的正确答案是 `content.attributes.id/name`，而不是 `ReferenceInfo`
自己的身份字段——按字段名想当然会得到「资源引用了它自己」。`replace_references` 若要
复用这批 `ReferenceInfo`，替换后应改用 `content.attributes` 复核落点。

`SeekLevel` 语义实测：`selection` 只看当前选中项（非选中查询返回 0 条），
`samePackageButNotExported` 在资源全部 exported 的包里返回 0 条，
`samePackage` 与 `all` 才有实际产出。

---

## 4. 可落地的能力增强

按"投入产出比 × 计划文档关联度"排序。每条都给出编辑器侧 API 依据。

### P0-A｜资源替换语义补全：直接解决计划 §1.1

编辑器有**完整的引用图 API**，Bridge 目前完全没有：

```csharp
DependencyQuery.QueryDependencies   // 查依赖
DependencyQuery.QueryReferences     // 查反向引用
DependencyQuery.ReplaceReferences   // 批量替换引用
DependencyQuery.references         // ReferenceInfo[]
ReferenceInfo { ownerPkg, pkgId, itemId, content, propKey, arrayIndex, valueType }
```

`ReferenceInfo.propKey` / `arrayIndex` 精确到"哪个对象的哪个属性槽"，
这正是计划 §1.1「图片资源替换语义不完整」缺的东西。

**建议新增 action：**

| action | 底层 |
| --- | --- |
| `query_references` | `QueryReferences` → 结构化 `ReferenceInfo[]` |
| `query_dependencies` | `QueryDependencies` |
| `replace_references` | `ReplaceReferences`（先 `query_references` 出预览，再执行） |

注意 `replace_object_resource` 当前是单对象覆盖；`replace_references` 是全工程语义，
两者应并存且参数区分清楚。

**0.8.11 已落地，实测修正了这份 API 清单的隐含假设：**

- `ReplaceReferences` 的签名 `(newItem)` 没有 old 参数——"old" 来自**同一个
  `DependencyQuery` 实例**上 `QueryReferences` 已经查出来的那批引用。跨请求活不过
  实例，所以执行时必须重新查询，不能拿预览时的列表去改全工程。
- 它**立即改包 XML**：文档既不会被标记 `isModified`，`HasUnsavedDocuments` 也仍为
  false。所有文档关闭时照样能改；打开着的文档内存状态会同步更新，之后普通保存不会
  把替换覆盖回去。因此 `save` 对它没有意义，验证只能是引用图口径
  （源残留必须为 0），不能宣称属性级一致。
- 它更新 `src`/`url`，但**不更新 image 元素的 `fileName`**，落盘即一处半状态。
  对照单对象路径 `Document.ReplaceSelection`（两者都更新），且该方法对"src 已等于目标"
  也会重写节点——所以这些节点下一次经文档模型保存时自动补齐。写 Action 以
  `staleFileNameSlots` / `warnings` 显式上报该事实，而不是宣称干净。
- 真机另有两处与声明给人的直觉相反：`ReferenceInfo` 的 `ownerPkg`/`itemId` 指的是
  **被引用方**（引用方在 `content` 里）；`valueType` 上 `image.src` 是 `id`、
  `loader.url` 才是 `url`。

### P0-B｜用真实 `editor.d.ts` 做编译期校验（工程性，零运行时成本）

`plugin/types/editor.d.ts` 目前是 **1476 字节的手写 stub**，文件头明确写着：

> 使用 any 是为了避免复制 FairyGUI 生成的大体积第三方声明文件

代价是：拼错一个成员名（如 `DuplcateItem`）编译照过，运行时才静默失败。
真实声明文件就在编辑器包内，无需复制维护——可以直接指向它：

```jsonc
// plugin/tsconfig.json
"paths": { "*": ["/Users/wilson/Downloads/FairyGUI-Editor.app/Contents/Resources/Data/StreamingAssets/Scripts/Puerts/*"] }
```

或用 `scripts/extract_editor_api.py` 生成裁剪版只保留用到的类型。
**收益**：新增 action 时编译器直接告诉你参数签名对不对，不再靠真机试错。

> 注意：这个改动会让 `strict` 从 `false` 变成有真实约束，
> 现有 `main.ts` 可能有几十处类型不匹配，需要一次性收敛。建议单独立项。

### P0-C｜走 `Document` 文档模型层写对象，而不是直接改 F* 对象模型

计划文档记录了两个真机踩坑，根因相同：

> ② `FRelations.Reset()+AddItem` 绕过文档模型会使文档卡在 modified 且 save 静默失败
> ③ `GetGear` 返回空接口 `IGear`（写入改为 `DocElement.UpdateGears`）

`DocElement` 就是编辑器自己的文档模型中介层，只有 21 个方法，但覆盖了所有写入口：

```csharp
DocElement.SetProperty / SetGearProperty / UpdateGears
DocElement.SetRelation / RemoveRelation / UpdateRelations
DocElement.SetExtensionProperty / SetChildProperty
DocElement.SetVertexPosition / SetVertexDistance / SetScriptData
```

更完整的是 `Document`（94 个方法），包含 Bridge 现在**完全没有覆盖**的编辑原语：

```
CreateGroup / DestroyGroup / OpenGroup / CloseGroup
InsertObject / RemoveObject / AdjustDepth
AddController / UpdateController / RemoveController / SwitchPage
DuplicateTransition / UpdateTransitions
CreateKeyFrame / AddKeyFrames / AddKeyFrame / RemoveKeyFrame(s)
SetKeyFrameProperty / SetKeyFrameValue / SetKeyFramePathPos / SetKeyFrameControlPointSmooth
CopySelection / Paste / DeleteSelection / MoveSelection
SwitchPage / EnterTimelineMode / RefreshTransition
```

**建议新增 action（直接补计划里未实现的条目）：**

| action | 底层 | 对应计划条目 |
| --- | --- | --- |
| `duplicate_transition`（0.8.16 已落地） | `Document.DuplicateTransition` | Phase 5 |
| `add_keyframes`（0.8.16 已落地） | `Document.CreateKeyFrame`（`AddKeyFrames(jsArray)` 6.1.4 不可用） | Phase 5「自动同步关键帧」 |
| `set_keyframe`（0.8.16 已落地） | `Document.SetKeyFrameProperty`（`SetKeyFrameValue` 6.1.4 不可用） | Phase 5 |
| `create_group` / `destroy_group` | `Document.CreateGroup` / `DestroyGroup` | Phase 0 缺口「无创建 Group 节点的 Action」 |
| `duplicate_object` | `Document.CopySelection` + `Paste` | Phase 2 |
| `adjust_depth` | `Document.AdjustDepth` | — |

**Phase 0 记录的那个夹具缺口（"Bridge 无创建 List/Group/Controller/Loader 节点的 Action"）
在这里直接解决**——`Document.CreateGroup` 和 `FComponent.CreateChild` 都在。

### P1-A｜关键帧 API：Phase 5 的核心缺口有原生解法

计划 Phase 5 标为未完成的：

> `[ ]` 支持根据节点属性变化自动更新相关关键帧
> `[ ]` 增加 `verify_transition`：检查 target 是否存在、关键帧是否超出对象范围

编辑器侧对应：

```csharp
Document.SetKeyFrameProperty / SetKeyFrameValue
Document.SetKeyFramePathPos / SetKeyFrameControlPointPos / SetKeyFrameControlPointSmooth
FTransitions.TakeSnapshot / ReadSnapshot / Write / ClearSnapshot
FTransitionItem.SetPathToTweener / AddPathPoint / UpdatePathPoint / CustomEase / PathPoints
AniData { fps, speed, repeatDelay, swing, frameList, spriteList }  // MovieClip 完整参数
AniSprite.SetPlaySettings / StepNext / StepPrev
```

`FTransitions.TakeSnapshot/ReadSnapshot` 尤其有价值：**这就是编辑器自己用的
"关键帧自动跟随属性变化"机制**，Bridge 现在是自己造 before 快照。

> **2026-10-20 状态**：`verify_transition` 的只读版已于 0.8.15 落地，**已在 FairyGUI
> Editor 6.1.4 真机复验**（模拟宿主 189/189、Python 44/44、tsc 0 error，证据
> `tests/reports/p8-3-verify-transition-live.json`）。写侧 `add_keyframes` /
> `set_keyframe` / `duplicate_transition` 已于 0.8.16 接入 Bridge 并**真机 6.1.4 验收**
> （模拟宿主 212/212、Python 50/50、tsc 0 error，证据
> `tests/reports/p8-3-keyframes-live.json`）：实际可用入口是 `CreateKeyFrame` +
> `SetKeyFrameProperty` + `DuplicateTransition`；`AddKeyFrames(jsArray)` 与
> `SetKeyFrameValue` 在 6.1.4 运行时不可用。`FTransitions.TakeSnapshot` 的自动跟随
> 仍未接入。

### P1-B｜预览与截图：离屏渲染路线已被真机证伪（2026-10-19）

计划 Phase 7「组件截图、视觉差分」标为未完成。编辑器声明里有：

```csharp
TestView   { Start, Reload, Stop, PlayTransition, ShowTooltips, ShowPopup }
PreviewView { Show }
FairyGUI.CaptureCamera {
    static Capture(target: DisplayObject, texture: RenderTexture,
                   contentHeight: number, offset: Vector2)   // 离屏渲染指定对象
    static CreateRenderTexture(width, height, stencilSupport)
}
App.testView
```

> **本节原判断「`CaptureCamera` 是正确入口，`render_component` 可直接实现」经
> FairyGUI Editor 6.1.4 真机验证不成立，已作废。** 完整证据见
> `tests/reports/p8-4-render-feasibility.json`。

结论要点：

- **编辑器不把工程组件交给 FairyGUI 运行时 stage 渲染。** `FObject.displayObject`
  （`FairyEditor.FDisplayObject`）的 `stage` 与 `bounds` 均为 null，`layer=0`（捕获相机在
  layer 30），`CheckMain()` 后 `cachedCamera` 仍为 null。它继承 `Container` 而非 `GObject`，
  `AddChild` 到 `GRoot` 抛 `GComponent.AddChildAt` 的 NRE。
- **`Capture` 会静默产出全透明空图。** 对工程组件调用不报错、PNG 正常写出，但 57600 个
  像素全为 (0,0,0,0)；baseline / 设 layer / 抓 content / 新建 GRoot / forceUpdate 五种策略
  结果字节数完全一致。这是**假成功**：调用成功、文件存在、图像是空的。
- **编辑器自己的 `TestView` 同样不可用。** `Start()` 能建出真实 `GComponent`（14 个子节点），
  但连续 115 帧 `stage` 始终为 null；强行挂进 `GRoot.inst` 也一样（`GRoot.inst` 本身仅 400x372）。
- **仍然可用的部分：** `UnityEngine.ImageConversion.EncodeToPNG` 运行时存在（**声明里没有**），
  `File.WriteAllBytes` 落盘链路完整；`Camera.main` 设 `targetTexture` → `Render()` →
  `ReadPixels` 机制通畅（只是拍不到目标）；插件支持跨帧异步 Action。
- `StageCamera.camera` 与 `StageCamera.cachedMainCamera` 运行时均为 null。

因此 `render_component`（离屏组件截图）**已放弃**，Phase 7 的截图诉求改由「发布后在
Unity 侧渲染」承担。`preview_run`（驱动 `TestView` 做交互预览）不受此证伪影响，仍可实现。

### P1-C｜发布与图集配置：从"只读设置"到"可控发布"

`get_publish_settings` 当前只读 `GlobalPublishSettings`。编辑器侧还有：

```csharp
PublishSettings { path, fileName, packageCount, genCode, codePath,
                  branchPath, useGlobalAtlasSettings, atlasList, excludedList }
PackSettings   { pot, mof, padding, rotation, minWidth, minHeight, maxWidth,
                 maxHeight, square, fast, edgePadding, duplicatePadding, multiPage }
AtlasSettings  { name, compression, extractAlpha, packSettings }
GlobalPublishSettings { codeGeneration, compressDesc, binaryFormat, jpegQuality,
                        compressPNG, includeHighResolution, branchProcessing,
                        seperatedAtlasForBranch, atlasSetting, include2x/3x/4x }
PublishHandler { ExportBinaryDesc, ExportDescZip, ExportResZip, ExportResFiles,
                 ClearOldResFiles, CollectClasses, SetupCodeFolder, GetScriptData }
```

计划 Phase 5 有一条：

> `[x]` 对大图和大帧集给出 atlas/alone 建议（**0.8.14 已落地**：0.8.12 只读分析 `analyze_atlas_fit`，0.8.14 把 `import_image` / `publish` 的归属施加也换成同一套真实约束判定）

`AtlasSettings.packSettings.minWidth/minHeight/pot/rotation` 就是图集打包器的
**真实约束**。Bridge 原来的 `1920×1080` / `2048` 硬编码常量是猜测（它把 1920x1080
判成 alone，而 2048 的页装得下）；**0.8.14 已按真实约束判定**，常量只留作诊断对照。

**已实现**：`set_publish_settings`（按包设图集/代码生成/分支排除）、
`analyze_atlas_fit`（按真实 PackSettings 判断每张图能否入图集，与写入路径同源）。

**分步导出不可用（2026-10-20 真机探针）**：`PublishHandler` 的 public
`ExportBinaryDesc` / `ExportResFiles` 等不是独立入口，而是 `Run()` 内部流水线的
一段。`Run()` 前调用 `ExportBinaryDesc` 会因缺少内部 `package.xml` 字典条目抛
`KeyNotFoundException`；`Run(publishDescOnly=true)` 后 `ExportResFiles` 不产出
文件；完整 `Run()` 后再次调用 `ExportResFiles` 会写 0 字节文件并挂死编辑器主线程。
准备步骤 `CollectItems` / `LoadImages` / `CreateBins` / `CreateOutput` 均为
private，且 `MethodInfo.Invoke` 被 IL2CPP/Puerts 裁剪，插件侧无法驱动。因此
Bridge 不暴露分步导出：`publish` 的 `publishDescOnly` 是唯一安全的“只导描述”
入口，“只导资源”没有安全的原生路径。证据
`tests/reports/p8-5-publish-steps-probe.json`。

### P1-D｜分支（Branch）：0.8.18 已落地读取、创建与写入寻址

编辑器完整支持：

```csharp
FProject  { activeBranch (get/set), allBranches, CreateBranch, RenameBranch,
            RemoveBranch, ScanBranches }
FPackage  { GetBranchRootItem, CreateBranch, GetBranchPath }
FPackageItem { branch, isBranchRoot, GetBranch, GetTrunk, GetHighResolution, GetStdResolution }
PublishSettings.branchPath / GlobalPublishSettings.branchProcessing / seperatedAtlasForBranch
```

Bridge 已实现：

- `list_branches`（只读，可附带分支内包与资源）、`create_branch`、`switch_branch`；
  创建与切换走工程原生 API，立即落盘、不可撤销。
- `list_items` / `open_document` / `get_tree` 与组件、按钮、图片/字体/声音、
  MovieClip 的创建/导入 Action 支持 `branch` 参数；省略按当前活跃分支，`branch=""` 表示主干。
- 分支资源位于 `assets_<branch>/<pkg>/`，清单为 `package_branch.xml`；写验证比对分支清单。
- `replace_references` / `clear_atlas_markers` 保持主干专用，分支活跃时拒绝。

6.1.4 真机得到的约束（详见 `tests/reports/p8-6-branches-live.json`）：

- `CreateComponentItem` / `CreateFolder` / `ImportResource` / `CreateMovieClipItem`
  的分支路径必须是 `/:branch/` 或 `/:branch/Sub/`（末尾斜杠不可省略），
  `GetItemByPath` 无法解析分支路径，读取要走 `GetBranchRootItem` + `GetItemListing`。
- `activeBranch` **不会**把主干文档的保存改道到分支；分支文档要求该分支活跃，
  主干文档在分支活跃时也拒绝保存。
- `activeBranch` 不跨编辑器重启保留，重启后回到主干，但分支磁盘内容仍在。

尚未 Bridge 化：`RenameBranch` / `RemoveBranch` / `GetTrunk` / 分支发布与
`seperatedAtlasForBranch`。分支删除仍只能在编辑器里完成。

### P2｜其余可直接复用的域

**i18n（完全空白）**

```csharp
ImportStringsHandler { Parse, Import, strings }
ExportStringsHandler { Parse, Export }
I18nSettings { langFiles, lang, SetLangByName, LoadStrings }
```

**工程审计（0.8.19 已落地免授权实现）**

```csharp
FindUnusedResource { result, Start, Cancel }        // 找未使用资源（Pro）
FindDuplicateResource { result, GetGroup, Start, Cancel }  // 找重复资源（Pro）
FullSearch { result, Start }                          // 全文搜索（Pro，未暴露）
ReferenceView { Open, FillMenuTargets }              // 引用视图（UI，不做）
AssetSizeUtil { GetSize }                            // 图片尺寸/类型/位深（免授权可用）
BuilderUtil { GetMD5HashFromFile }                   // 文件内容哈希（免授权可用）
```

真机 6.1.4 实测：`FindUnusedResource.Start`、`FindDuplicateResource.Start` 都会先走
`CheckProLicense`，非 Pro 环境弹出模态授权框，插件请求永久等不到返回；`FullSearch.Start`
同样超时。因此 Bridge **不调用**这些原生入口，改为组合免授权 API：

- `find_unused` = 遍历资源 + `DependencyQuery.QueryReferences`，引用数为 0 即未使用；
- `find_duplicate` = `BuilderUtil.GetMD5HashFromFile` + 文件字节数分组；
- 图片尺寸来自 `AssetSizeUtil.GetSize`（返回宽高、类型、位深、颜色类型）。

这套组合与原生审计语义一致，且不会触发授权框。证据见
`tests/reports/p8-7-audit-live.json`。`FindUnusedResource` / `FindDuplicateResource`
的返回结构（`result` / `GetGroup`）仍未直接使用，`FullSearch` 需要另找免授权替代路径。

**原生撤销栈**

```csharp
ActionHistory { CanUndo, CanRedo, Add, GetPendingList, PushHistory,
                PopHistory, Undo, Redo, Reset }
ObjectSnapshot { Take, Load, ... }  // 22 个属性
```

Bridge 自己维护了 `agentUndoStack` / `agentRedoStack`。编辑器有原生栈，
而 `ObjectSnapshot` 正是 `verify_document` 想要的通用快照格式——
可以省掉大量手写比对逻辑，并与编辑器行为一致。

**其他**

- `XMLExtension`（声明为空，实际能力在 `FairyEditor.Component`）— 组件 XML 导入导出，可能支持整体往返
- `ComExtention` / `ComProperty` / `CustomProps` / `RegisterComExtension` — 自定义组件属性体系
- `Clipboard` / `NativeDragDrop` / `WindowUtil` / `ResourceImportQueue` — 编辑器基础设施
- `App.Dispatch` / `On` / `Off` / `add_onProjectOpened` / `add_onValidate` — 事件驱动，可替代部分轮询
- `ConsoleView.Log/LogError/LogWarning` — 把 Agent 操作与错误回显到**用户可见的编辑器控制台**，
  而不是只写日志文件

---

## 5. 建议的落地顺序

| 批次 | 内容 | 理由 |
| --- | --- | --- |
| 1 | P0-C（Document 层写操作）+ P0-B（真实类型校验） | 先把写入路径纠正到文档模型层，再加新能力；否则新 action 会复制现有坑 |
| 2 | P0-A（引用图/替换语义） | 直接解决计划 §1.1，是计划里最明确的技术债 |
| 3 | ~~P1-B（截图/预览）~~ **2026-10-19 拆分**：离屏截图路线证伪后放弃，`preview_run` 保留；P1-C（发布图集）照做 | P1-C 单独解锁 Phase 5 的硬骨头；P1-B 只剩交互预览，Phase 7 截图改走 Unity 侧 |
| 4 | P1-A（关键帧）+ ~~P1-D（分支）~~ **均已完成**（0.8.16 / 0.8.18） | 动画深入与新能力域 |
| 5 | P2 批量（i18n / 审计 / 原生撤销栈） | 单个实现成本低，收益立竿见影。审计已落地（0.8.19 `find_unused` / `find_duplicate`，免 Pro 授权），i18n / 原生撤销栈 / 控制台可见性待做 |

---

## 6. 复现方式

```bash
# 重新提取完整 API 清单（不依赖本文档，可重复执行）
python3 scripts/extract_editor_api.py \
  ~/Downloads/FairyGUI-Editor.app \
  --out /tmp/fgui_editor_api.json

# REA 原生层（仅需 artifact 层，不需要 Ghidra/Hopper/IDA）
npx -y rea-agents@6.4.0 inspect-macho ~/Downloads/FairyGUI-Editor.app --format json
npx -y rea-agents@6.4.0 trace-dylib-resolution ~/Downloads/FairyGUI-Editor.app --format json

# 确认为何原生反编译不可用
npx -y rea-agents@6.4.0 analyze ~/Downloads/FairyGUI-Editor.app --format json
```

升级 FairyGUI Editor 后必须重新提取并 diff —— 本清单对应 **6.1.4**。
