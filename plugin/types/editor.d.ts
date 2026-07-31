/**
 * FairyGUI Agent Bridge 编译所需的最小宿主类型声明。
 *
 * 这里只描述 main.ts 实际使用的宿主入口；运行时对象由 FairyGUI Editor、
 * Puerts、Unity 和 .NET 提供。使用 any 是为了避免复制 FairyGUI 生成的
 * 大体积第三方声明文件，同时保留独立 TypeScript 构建能力。
 */
declare namespace CS {
    namespace System {
        const Array: any;
        const String: any;

        namespace IO {
            const Directory: any;
            const File: any;
            const FileInfo: any;
            const Path: any;
            const SearchOption: any;
        }
    }

    namespace UnityEngine {
        const Application: any;

        class Vector2 {
            constructor(x: number, y: number);
            x: number;
            y: number;
        }
    }

    namespace FairyEditor {
        const App: any;
        const ComponentTemplates: any;
        const FObjectType: any;
        const FPackageItemType: any;

        type FComponent = any;
        type FObject = any;
        type FPackage = any;
        type FPackageItem = any;

        class GlobalPublishSettings {
            [key: string]: any;
        }

        class PublishHandler {
            constructor(...args: any[]);
            [key: string]: any;
        }

        namespace PluginManager {
            type PluginInfo = any;
        }

        namespace View {
            type Document = any;
        }
    }
}
