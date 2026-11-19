// Pings: what changed on the record while the app was not in front, said as a notification on this phone. No server
// sends them and no device token leaves the phone. iOS wakes the app now and then (background app refresh), the app
// reads the work of the key the person's Claude signs with, as it does in front, and posts a notification here for
// what changed since it last looked. iOS decides when the app is woken, by how often the person opens it, the
// battery and the network, so a ping can come hours after the change, and none comes where Background App Refresh
// is off. A ping says what the banner in the app would have said, and a tap on one opens the answer it is about.
import BackgroundTasks
import UIKit
import UserNotifications

enum Pings {
    /// The background task's name, which Info.plist permits (project.yml).
    static let task = "org.bitquilt.quilt.refresh"

    /// What a ping says for something that changed, or nil where it is not worth one: an answer of the person's
    /// Claude, a match, a disagreement, and a draft that waits for the phone's signature are; a piece taken, an ask
    /// picked up and the app's own notices are not.
    static func words(for news: News, more: Int = 0) -> (title: String, body: String)? {
        switch news.kind {
        case .agreed, .differs, .returned, .asked:
            return (news.title, more > 0 ? "\(news.body) And \(more) more." : news.body)
        case .took, .other, .sent:
            return nil
        }
    }

    /// Whether the person has let this app notify them.
    static func allowed() async -> Bool {
        let status = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
        return status == .authorized || status == .provisional || status == .ephemeral
    }

    /// Whether the person turned notifications off for this app in Settings, where only they can turn them on again.
    static func refused() async -> Bool {
        await UNUserNotificationCenter.current().notificationSettings().authorizationStatus == .denied
    }

    /// Asks the person, once, in iOS's own words. Whether they said yes.
    static func ask() async -> Bool {
        (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])) ?? false
    }

    /// Posts one ping now. `reading` names the answer a tap opens.
    static func post(_ news: News, more: Int = 0, reading: String? = nil) {
        guard let words = words(for: news, more: more) else { return }
        let content = UNMutableNotificationContent()
        content.title = words.title
        content.body = words.body
        content.sound = .default
        if let reading { content.userInfo = ["reading": reading] }
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil))
    }

    /// Asks iOS to wake the app again, no sooner than a quarter of an hour from now. iOS takes the request as a
    /// wish, and a simulator does not take it at all.
    static func schedule() {
        let request = BGAppRefreshTaskRequest(identifier: task)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
        try? BGTaskScheduler.shared.submit(request)
    }

    /// Takes the wish back: the person turned pings off.
    static func unschedule() {
        BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: task)
    }
}

/// What the app does with a ping: shows it even where the app has come to the front in the meantime, and opens the
/// answer it names when it is tapped.
final class PingsDelegate: NSObject, UNUserNotificationCenterDelegate {
    static let shared = PingsDelegate()

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let reading = response.notification.request.content.userInfo["reading"] as? String
        await Store.shared.opened(ping: reading)
    }
}
