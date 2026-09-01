import UIKit
import UserNotifications

@main
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {

        UNUserNotificationCenter.current().delegate = self

        // 首次冷启动即申请通知权限，用药提醒依赖它
        NotificationManager.shared.requestAuthorization { granted in
            print("[补药] 通知权限:", granted ? "已授权" : "未授权")
        }

        let window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = ViewController()
        window.makeKeyAndVisible()
        self.window = window

        return true
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // 本地服务器在后台无意义，释放端口避免系统回收时告警
        // 回到前台时 ViewController 不会重启服务，故此处保持运行，仅做轻量处理
    }

    func applicationWillTerminate(_ application: UIApplication) {
        LocalServer.shared.stop()
    }
}

// MARK: - 通知回调

extension AppDelegate: UNUserNotificationCenterDelegate {

    /// 前台也要能弹出提醒
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                willPresent notification: UNNotification,
                                withCompletionHandler completionHandler:
                                @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound, .badge])
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        completionHandler()
    }
}
