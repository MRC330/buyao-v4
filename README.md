# 补药 iOS 版 · 构建说明

> 本目录是一个**可直接用 Xcode 打开的完整工程**。
> 双击 `BuYao.xcodeproj` → 连上 iPhone → 点运行即可。

---

## 一、为什么给的是工程而不是 IPA

IPA 是**签名后的成品包**，签名必须用你的 Apple 开发者证书。
我这边是 Linux 沙箱，既没有 Xcode 也没有你的证书，物理上做不出来。

给你工程的好处：

- 用自己的证书签名，装到手机上永久有效（不越狱）
- **免费 Apple ID 就能用**，无需付 688 元/年的开发者账号
- 以后改功能、换图标，改完重新点运行即可

---

## 二、最快上手（3 步）

1. 把整个 `ios_build` 文件夹拷到 Mac 上
2. 双击 `BuYao.xcodeproj`（用 Xcode 打开）
3. 左侧点最上面的 `BuYao` → **Signing & Capabilities**
   → 勾选 `Automatically manage signing`
   → Team 选你的 Apple ID

然后 iPhone 连上 Mac，顶部设备选你的手机，按 `⌘R` 运行。

> 首次会在手机上提示「未受信任的企业级开发者」，
> 去 `设置 → 通用 → VPN与设备管理` 点信任即可。

---

## 三、命令行打包（可选）

想要 IPA 文件发给别人装：

```bash
chmod +x build_ipa.sh
./build_ipa.sh
```

产出 `build/ipa/BuYao.ipa`。

---

## 四、工程结构

```
BuYao.xcodeproj/                 Xcode 工程
BuYao/
├── AppDelegate.swift            应用入口 + 通知权限
├── ViewController.swift         WKWebView 容器
├── Bridge.swift                 JS 原生桥 + 通知 + Toast
├── LocalServer.swift            本地 HTTP 服务（见下方说明）
├── Info.plist                   权限声明、版本号
├── LaunchScreen.storyboard      启动屏（粉色底 + 应用图标）
├── Assets.xcassets/
│   └── AppIcon.appiconset/      全套图标（9 个尺寸，已配好）
└── www/                         前端页面（与安卓版完全一致）
    ├── index.html
    ├── style.css
    ├── js/                      core / features / ui / app / v31
    └── ocr/                     tesseract 中文识别模型
```

---

## 五、两个关键设计，改动时别踩坑

### 1. 为什么内置一个 HTTP 服务器

OCR 识别用的 tesseract.js 需要加载 worker 和 wasm 文件。
如果直接用 `file://` 打开，WKWebView 的同源策略会拦截，**识别功能直接失效**。

所以 `LocalServer.swift` 在 App 内起了一个只监听 `127.0.0.1` 的服务，
把 `www` 目录以 http 方式提供出去，同源加载，一切正常。

- 只监听回环地址，外界访问不到，安全
- 端口由系统自动分配，不冲突
- App 退出时自动关闭

**如果你改了 www 目录的内容，不需要动任何代码**，刷新页面即可生效。

### 2. JS 桥接是怎么打通的

安卓版前端通过 `window.Android` 调用原生能力，iOS 上补齐了同名接口，
**前端代码一个字都不用改**。共三个方法：

| 方法 | 作用 |
|---|---|
| `toast(msg)` | 原生提示气泡 |
| `shareText(text, title)` | 系统分享面板 |
| `scheduleReminders(json)` | 同步用药提醒计划 |

实现原理：WKWebView 不允许直接注入 JS 对象，
所以 `Bridge.swift` 在页面加载时注入一段脚本构造 `window.Android` 外壳，
内部转发到 `window.webkit.messageHandlers.buyao`，再由 Swift 侧接收处理。

提醒计划的数据格式：

```json
[{"time":"08:00","title":"该服用 阿莫西林"}, ...]
```

Swift 收到后调用 `UNUserNotificationCenter` 安排**每日重复**的本地通知。
每次保存数据都会全量重排（先清旧的再建新的）。

---

## 六、图标说明

iOS 图标**必须是不透明的**——App Store 会拒绝带透明通道的图标，
圆角由系统统一施加。所以这里用的是方形满铺版本，
配色沿用安卓版的 **粉 #F8BDBF 30% / 白 70%**。

已生成的尺寸：

| 文件 | 尺寸 | 用途 |
|---|---|---|
| Icon-20@2x / @3x | 40 / 60 | 通知 |
| Icon-29@2x / @3x | 58 / 87 | 设置 |
| Icon-40@2x / @3x | 80 / 120 |  spotlight 搜索 |
| Icon-60@2x / @3x | 120 / 180 | 主屏幕 |
| Icon-1024 | 1024 | App Store |

---

## 七、和安卓版的差异

| 项目 | 安卓 | iOS |
|---|---|---|
| 前端代码 | 完全一致（同一份 www） | 完全一致 |
| 提醒实现 | AlarmManager + 广播 | UNUserNotificationCenter 本地通知 |
| 资源加载 | file:// | 本地 HTTP（绕过同源限制） |
| 图标形状 | 圆形（画布内留白） | 方形满铺（系统加圆角） |
| 包名 | com.medapp.yaoguanjia | com.medapp.buyao |
| 版本号 | 4.0 | 4.0 |

⚠️ 两个平台的数据是**各自独立**的，不会同步。
如需迁移，用 App 内的「导出备份」生成 JSON，在另一台导入即可。

---

## 八、上架前还需要做的事

1. 换 Bundle ID（`Signing & Capabilities` 里改成你自己的，如 `com.yourname.buyao`）
2. 准备隐私政策链接（App Store 审核必需）
3. 补充 OCR 功能的说明文案（审核会问为什么要用相机）
4. 若用免费证书，7 天需重装一次；正式上架需要付费开发者账号
