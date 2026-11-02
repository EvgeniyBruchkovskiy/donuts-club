import Foundation

/// Mirrors functions/src/social (PostView, AccountView).

enum Platform: String, Codable, CaseIterable, Identifiable, Hashable {
    case instagram, threads
    var id: String { rawValue }
    var title: String { self == .instagram ? "Instagram" : "Threads" }
    var symbol: String { self == .instagram ? "camera" : "at" }
}

enum PostKind: String, Codable, CaseIterable, Identifiable {
    case image, carousel, video, story, text
    var id: String { rawValue }

    var title: String {
        switch self {
        case .image: "Фото"
        case .carousel: "Карусель"
        case .video: "Reels"
        case .story: "Сторіс"
        case .text: "Текст"
        }
    }

    var symbol: String {
        switch self {
        case .image: "photo"
        case .carousel: "square.stack"
        case .video: "play.rectangle"
        case .story: "circle.dashed"
        case .text: "text.alignleft"
        }
    }

    /// Where this kind can go: stories are Instagram-only, text posts Threads-only.
    var platforms: [Platform] {
        switch self {
        case .story: [.instagram]
        case .text: [.threads]
        default: [.instagram, .threads]
        }
    }

    var maxMedia: Int {
        switch self {
        case .text: 0
        case .carousel: 10
        default: 1
        }
    }

    var minMedia: Int {
        switch self {
        case .text: 0
        case .carousel: 2
        default: 1
        }
    }

    var hasCaption: Bool { self != .story }
}

enum PostStatus: String, Codable {
    case scheduled, publishing, published, failed
}

struct PlatformResult: Codable, Hashable {
    enum State: String, Codable { case pending, processing, published, failed }
    let state: State
    let permalink: String?
    let error: String?
}

struct Post: Codable, Identifiable, Hashable {
    let id: String
    let kind: PostKind
    let platforms: [Platform]
    let caption: String
    let threadsText: String?
    let mediaCount: Int
    let thumb: String?
    let scheduledAt: Date
    let status: PostStatus
    let results: [String: PlatformResult]
    let createdAt: Date
    let publishedAt: Date?

    func result(_ p: Platform) -> PlatformResult? { results[p.rawValue] }

    var thumbData: Data? { thumb.flatMap { Data(base64Encoded: $0) } }

    var isEditable: Bool { status == .scheduled || status == .failed }
}

struct Account: Codable, Hashable {
    let username: String
    let expiresAt: Date?
    let refreshError: String?
}

struct Accounts: Codable, Hashable {
    var instagram: Account?
    var threads: Account?

    subscript(_ p: Platform) -> Account? { p == .instagram ? instagram : threads }
}
