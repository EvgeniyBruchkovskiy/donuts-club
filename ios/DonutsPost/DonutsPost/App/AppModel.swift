import Foundation
import Observation

/// What a new post is made of before it is sent.
struct Draft {
    var kind: PostKind = .image
    var platforms: Set<Platform> = [.instagram, .threads]
    var caption = ""
    var separateThreads = false
    var threadsText = ""
    var media: [MediaFile] = []
    var scheduledAt = Draft.defaultTime()

    static let captionLimit = 2200
    static let threadsLimit = 500

    /// The next full hour, at least 15 minutes away.
    static func defaultTime(now: Date = .now) -> Date {
        let cal = Calendar.current
        let next = cal.nextDate(after: now.addingTimeInterval(15 * 60), matching: DateComponents(minute: 0), matchingPolicy: .nextTime) ?? now
        return next
    }

    var chosenPlatforms: [Platform] { Platform.allCases.filter { platforms.contains($0) && kind.platforms.contains($0) } }

    var threadsBody: String { separateThreads ? threadsText : caption }

    /// The first problem that blocks sending, in the words the composer shows.
    var problem: String? {
        if chosenPlatforms.isEmpty { return "Оберіть, куди публікувати." }
        if media.count < kind.minMedia {
            return kind == .carousel ? "Додайте щонайменше 2 фото чи відео." : "Додайте фото чи відео."
        }
        if media.count > kind.maxMedia { return "Забагато файлів для цього типу." }
        if kind == .image, media.first?.kind != .image { return "Для відео оберіть тип Reels." }
        if kind == .video, media.first?.kind != .video { return "Для фото оберіть тип «Фото»." }
        if caption.count > Draft.captionLimit { return "Текст для Instagram задовгий." }
        if chosenPlatforms.contains(.threads) {
            if threadsBody.count > Draft.threadsLimit { return "Текст для Threads задовгий — до 500 символів." }
            if kind == .text, threadsBody.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return "Напишіть текст." }
        }
        if scheduledAt < Date.now.addingTimeInterval(-5 * 60) { return "Цей час уже минув." }
        return nil
    }

    /// Non-blocking hints about Meta's limits.
    var warnings: [String] {
        var out: [String] = []
        for m in media where m.kind == .video {
            let d = m.duration ?? 0
            if kind == .story, d > 60 { out.append("Сторіс-відео довше 60 с — Instagram може його відхилити.") }
            if kind != .story, d < 3 { out.append("Reels має бути не коротше 3 секунд.") }
            if chosenPlatforms.contains(.threads), d > 300 { out.append("Threads приймає відео до 5 хвилин.") }
        }
        if kind == .carousel, media.contains(where: { $0.kind == .video }), chosenPlatforms.contains(.instagram) {
            out.append("Instagram обріже всі елементи каруселі під пропорції першого.")
        }
        return out
    }
}

@MainActor @Observable
final class AppModel {
    var pin: String? = Keychain.get("pin")
    var accounts = Accounts()
    var posts: [Post] = []
    var loading = false
    var error: String?
    var lastLoaded: Date?

    /// Upload state shown over the composer while a post is being sent.
    var sending: SendProgress?

    struct SendProgress: Equatable {
        var step: String
        var fraction: Double
    }

    private var api: SocialAPI? { pin.map { SocialAPI(pin: $0) } }

    var upcoming: [Post] { posts.filter { $0.status != .published }.sorted { $0.scheduledAt < $1.scheduledAt } }
    var published: [Post] { posts.filter { $0.status == .published }.sorted { ($0.publishedAt ?? $0.scheduledAt) > ($1.publishedAt ?? $1.scheduledAt) } }

    func login(_ pin: String) async throws {
        let accounts = try await SocialAPI(pin: pin).login()
        Keychain.set("pin", pin)
        self.pin = pin
        self.accounts = accounts
        await refresh()
    }

    func logout() {
        Keychain.set("pin", nil)
        pin = nil
        posts = []
        accounts = Accounts()
    }

    init() {
        #if DEBUG
        if DemoData.isOn {
            pin = "demo"
            accounts = DemoData.accounts
            posts = DemoData.posts
        }
        #endif
    }

    func refresh() async {
        #if DEBUG
        if DemoData.isOn { return }
        #endif
        guard let api else { return }
        loading = true
        defer { loading = false }
        do {
            let r = try await api.posts()
            posts = r.items
            accounts = r.accounts
            lastLoaded = .now
            error = nil
        } catch let e as APIError where e.isBadPin {
            logout()
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// Uploads the media straight to the bucket, then schedules the post.
    func send(_ draft: Draft) async throws {
        guard let api else { return }
        defer { sending = nil }
        var draftId = String(repeating: "0", count: 16)
        var media: [[String: String]] = []

        if !draft.media.isEmpty {
            sending = SendProgress(step: "Готуємо завантаження…", fraction: 0)
            let up = try await api.upload(kinds: draft.media.map(\.kind))
            draftId = up.draftId
            let total = max(1, draft.media.reduce(Int64(0)) { $0 + $1.size })
            var done: Int64 = 0
            for (i, (file, target)) in zip(draft.media, up.files).enumerated() {
                let step = draft.media.count > 1 ? "Завантажуємо \(i + 1) з \(draft.media.count)…" : "Завантажуємо…"
                let base = done
                sending = SendProgress(step: step, fraction: Double(base) / Double(total))
                try await SocialAPI.put(file: file.file, to: target.url, contentType: target.contentType) { sent in
                    Task { @MainActor in self.sending?.fraction = Double(base + sent) / Double(total) }
                }
                done += file.size
                media.append(["path": target.path, "kind": file.kind.rawValue])
            }
        }

        sending = SendProgress(step: "Плануємо публікацію…", fraction: 1)
        var post: [String: Any] = [
            "kind": draft.kind.rawValue,
            "platforms": draft.chosenPlatforms.map(\.rawValue),
            "caption": draft.kind.hasCaption ? draft.caption : "",
            "media": media,
            "scheduledAt": SocialAPI.iso(max(draft.scheduledAt, .now)),
        ]
        if draft.separateThreads, draft.chosenPlatforms.contains(.threads) { post["threadsText"] = draft.threadsText }
        if let first = draft.media.first, let thumb = MediaProcessor.thumbBase64(first.preview) { post["thumb"] = thumb }
        _ = try await api.create(draftId: draftId, post: post)
        MediaProcessor.clearTemp()
        await refresh()
    }

    func update(_ post: Post, caption: String?, threadsText: String?, platforms: [Platform]?, scheduledAt: Date?) async throws {
        guard let api else { return }
        var f: [String: Any] = [:]
        if let caption { f["caption"] = caption }
        if let threadsText { f["threadsText"] = threadsText }
        if let platforms { f["platforms"] = platforms.map(\.rawValue) }
        if let scheduledAt { f["scheduledAt"] = SocialAPI.iso(scheduledAt) }
        replace(try await api.update(id: post.id, fields: f))
    }

    func publishNow(_ post: Post) async throws {
        guard let api else { return }
        replace(try await api.publishNow(id: post.id))
    }

    func remove(_ post: Post) async throws {
        guard let api else { return }
        try await api.remove(id: post.id)
        posts.removeAll { $0.id == post.id }
    }

    func connect(_ platform: Platform, token: String) async throws {
        guard let api else { return }
        accounts = try await api.connect(platform, token: token)
    }

    func disconnect(_ platform: Platform) async throws {
        guard let api else { return }
        accounts = try await api.disconnect(platform)
    }

    private func replace(_ p: Post) {
        if let i = posts.firstIndex(where: { $0.id == p.id }) { posts[i] = p } else { posts.append(p) }
    }
}
