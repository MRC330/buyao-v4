import Foundation
import WebKit
import UIKit
import UserNotifications

/// JS 原生桥
///
/// 安卓版前端通过 window.Android 调用原生能力，iOS 这里补齐同名接口，
/// 前端代码无需任何改动。桥只有三个方法：
///   toast(msg)                  —— 原生提示
///   shareText(text, title)      —— 系统分享
///   scheduleReminders(jsonStr)  —— 同步用药提醒计划
///
/// WKWebView 不允许直接注入 JS 对象，只能走 messageHandler。
/// 故在页面加载时注入一段脚本，构造 window.Android 外壳，
/// 内部转发到 window.webkit.messageHandlers.buyao。
final class Bridge: NSObject, WKScriptMessageHandler {

    static let shared = Bridge()

    /// 注入到页面的桥接脚本
    static let injectScript = """
    (function(){
      if (window.Android) { return; }
      var send = function(action, payload){
        try {
          window.webkit.messageHandlers.buyao.postMessage(
            Object.assign({ action: action }, payload || {})
          );
        } catch(e) { console.warn('bridge unavailable', e); }
      };
      window.Android = {
        toast: function(msg){ send('toast', { msg: String(msg) }); },
        shareText: function(text, title){
          send('share', { text: String(text), title: String(title || '补药') });
        },
        scheduleReminders: function(json){
          send('remind', { plans: String(json) });
        }
      };
      window.MedKeeper = window.Android;
    })();
    """

    private override init() { super.init() }

    func userContentController(_ controller: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any],
              let action = body["action"] as? String else { return }

        switch action {
        case "toast":
            if let msg = body["msg"] as? String { showToast(msg) }
        case "share":
            let text = body["text"] as? String ?? ""
            let title = body["title"] as? String ?? "补药"
            share(text: text, title: title)
        case "remind":
            if let plans = body["plans"] as? String { schedule(plans) }
        default:
            break
        }
    }

    // MARK: - 具体实现

    private func showToast(_ msg: String) {
        DispatchQueue.main.async { Toast.show(msg) }
    }

    private func share(text: String, title: String) {
        DispatchQueue.main.async {
            guard let root = UIApplication.shared.topViewController() else { return }
            let av = UIActivityViewController(activityItems: [text], applicationActivities: nil)
            // 用 completionWithItemsHandler 判断用户是否完成分享
            av.completionWithItemsHandler = { activityType, completed, _, _ in
                if completed {
                    print("[补药] 分享完成: \(activityType?.rawValue ?? "")")
                }
            }
            // iPad 上必须设置源视图，否则会崩溃
            if let pop = av.popoverPresentationController {
                pop.sourceView = root.view
                pop.sourceRect = CGRect(x: root.view.bounds.midX,
                                        y: root.view.bounds.midY,
                                        width: 0, height: 0)
                pop.permittedArrowDirections = []
            }
            root.present(av, animated: true)
        }
    }

    /// plans 形如 [{"time":"08:00","title":"该服用 阿莫西林"}, ...]
    private func schedule(_ json: String) {
        guard let data = json.data(using: .utf8),
              let plans = try? JSONSerialization.jsonObject(with: data),
              let list = plans as? [[String: Any]] else { return }

        let items: [(hour: Int, minute: Int, title: String)] = list.compactMap { item in
            guard let time = item["time"] as? String else { return nil }
            let parts = time.split(separator: ":").compactMap { Int($0) }
            guard parts.count >= 2 else { return nil }
            let title = (item["title"] as? String) ?? "该服药了"
            return (parts[0], parts[1], title)
        }
        NotificationManager.shared.scheduleDaily(items: items)
    }
}

// MARK: - 通知

final class NotificationManager: NSObject {

    static let shared = NotificationManager()
    private override init() { super.init() }

    func requestAuthorization(completion: ((Bool) -> Void)? = nil) {
        UNUserNotificationCenter.current().requestAuthorization(
            options: [.alert, .sound, .badge]
        ) { granted, error in
            DispatchQueue.main.async { completion?(granted) }
        }
    }

    /// 全量重排：先清掉旧的，再按新计划重建
    func scheduleDaily(items: [(hour: Int, minute: Int, title: String)]) {
        let center = UNUserNotificationCenter.current()
        center.removeAllPendingNotificationRequests()

        for item in items {
            var date = DateComponents()
            date.hour = item.hour
            date.minute = item.minute

            let content = UNMutableNotificationContent()
            content.title = "补药"
            content.body = item.title
            content.sound = .default

            let trigger = UNCalendarNotificationTrigger(dateMatching: date, repeats: true)
            let id = String(format: "buyao-%02d%02d", item.hour, item.minute)
            let request = UNNotificationRequest(identifier: id, content: content, trigger: trigger)
            center.add(request)
        }
    }
}

// MARK: - 轻量 Toast

final class Toast {
    static func show(_ message: String) {
        guard let window = UIApplication.shared.keyWindow else { return }

        let label = UILabel()
        label.text = message
        label.textColor = .white
        label.font = UIFont.systemFont(ofSize: 15)
        label.textAlignment = .center
        label.numberOfLines = 0
        label.backgroundColor = UIColor(white: 0.1, alpha: 0.92)
        label.layer.cornerRadius = 10
        label.layer.masksToBounds = true

        let maxWidth: CGFloat = min(window.bounds.width - 60, 320)
        let size = label.sizeThatFits(CGSize(width: maxWidth - 28, height: 200))
        label.frame = CGRect(x: 0, y: 0,
                             width: size.width + 28, height: size.height + 20)
        label.center = CGPoint(x: window.bounds.midX,
                                y: window.bounds.height - 130)
        label.alpha = 0
        window.addSubview(label)

        UIView.animate(withDuration: 0.22, animations: { label.alpha = 1 }) { _ in
            UIView.animate(withDuration: 0.22, delay: 1.9, options: [],
                           animations: { label.alpha = 0 }) { _ in
                label.removeFromSuperview()
            }
        }
    }
}

// MARK: - 辅助

extension UIApplication {
    func topViewController(base: UIViewController? = nil) -> UIViewController? {
        let base = base ?? keyWindow?.rootViewController
        if let nav = base as? UINavigationController {
            return topViewController(base: nav.visibleViewController)
        }
        if let tab = base as? UITabBarController, let selected = tab.selectedViewController {
            return topViewController(base: selected)
        }
        if let presented = base?.presentedViewController {
            return topViewController(base: presented)
        }
        return base
    }

    var keyWindow: UIWindow? {
        connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .first { $0.isKeyWindow }
    }
}
