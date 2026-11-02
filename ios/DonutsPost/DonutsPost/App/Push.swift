import UIKit
import UserNotifications

/// Asks for notification permission, hands the APNs token to the server and shows pushes in the foreground.
final class PushDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    /// Set by the app once the model exists.
    @MainActor static var onToken: ((String) -> Void)?
    @MainActor static var onOpen: ((String) -> Void)?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        Task { @MainActor in PushDelegate.onToken?(hex) }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {}

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .sound, .list]
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        guard let id = response.notification.request.content.userInfo["postId"] as? String else { return }
        await MainActor.run { PushDelegate.onOpen?(id) }
    }

    /// Asks once; afterwards just re-registers so a changed token reaches the server.
    @MainActor static func start() async {
        let granted = (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])) ?? false
        if granted { UIApplication.shared.registerForRemoteNotifications() }
    }

    /// Development-signed builds (Xcode, devicectl) talk to the APNs sandbox; TestFlight builds to production.
    static var apnsEnv: String {
        guard let url = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision"),
              let data = try? Data(contentsOf: url),
              let text = String(data: data, encoding: .isoLatin1) else { return "production" }
        return text.range(of: #"<key>aps-environment</key>\s*<string>development</string>"#, options: .regularExpression) != nil ? "sandbox" : "production"
    }
}
