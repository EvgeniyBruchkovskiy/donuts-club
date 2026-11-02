#if DEBUG
import Foundation

/// Launch with `-demo` (Debug builds only) to look at the screens without the server.
enum DemoData {
    static var isOn: Bool { ProcessInfo.processInfo.arguments.contains("-demo") }

    static let accounts = Accounts(
        instagram: Account(username: "donutsclub.krop", expiresAt: nil, refreshError: nil),
        threads: Account(username: "donutsclub.krop", expiresAt: nil, refreshError: nil)
    )

    static var posts: [Post] {
        let cal = Calendar.current
        func at(_ day: Int, _ h: Int, _ m: Int = 0) -> Date {
            cal.date(bySettingHour: h, minute: m, second: 0, of: cal.date(byAdding: .day, value: day, to: .now)!)!
        }
        func post(_ id: String, _ kind: PostKind, _ platforms: [Platform], _ caption: String, _ when: Date, _ status: PostStatus,
                  results: [String: PlatformResult] = [:], count: Int = 1, threads: String? = nil) -> Post {
            Post(id: id, kind: kind, platforms: platforms, caption: caption, threadsText: threads, mediaCount: count, thumb: nil,
                 scheduledAt: when, status: status, results: results, createdAt: .now, publishedAt: status == .published ? when : nil)
        }
        let ok = PlatformResult(state: .published, permalink: "https://www.instagram.com/p/demo/", error: nil)
        return [
            post("1", .image, [.instagram, .threads], "Фісташковий пончик повернувся 💚 Лише цього тижня — встигніть скуштувати!", at(0, 18), .scheduled),
            post("2", .carousel, [.instagram, .threads], "Осіннє меню: гарбузовий раф, масала, тірамісу 🍂", at(1, 9), .scheduled, count: 4,
                 threads: "Осіннє меню вже в Donuts Club 🍂"),
            post("3", .video, [.instagram], "Як ми глазуруємо пончики — 15 секунд медитації 🍩", at(1, 12, 30), .scheduled),
            post("4", .story, [.instagram], "", at(2, 10), .scheduled),
            post("5", .text, [.threads], "Сьогодні працюємо до 22:00. Заходьте на каву ☕️", at(0, 8), .failed,
                 results: ["threads": PlatformResult(state: .failed, permalink: nil, error: "The user has not accepted the invite to test the app.")]),
            post("6", .image, [.instagram, .threads], "Ранкова кава і пончик — найкращий початок дня", at(-1, 9), .published,
                 results: ["instagram": ok, "threads": ok]),
        ]
    }
}
#endif
