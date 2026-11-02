import Foundation

struct APIError: LocalizedError {
    let message: String
    let status: String?
    var errorDescription: String? { message }
    var isBadPin: Bool { status == "FAILED_PRECONDITION" && message == "Невірний PIN." }
}

/// The `socialAction` callable (functions/src/social/service.ts), spoken over plain HTTPS:
/// POST {"data": {...}} → {"result": ...} | {"error": {"message", "status"}}.
struct SocialAPI {
    static let endpoint = URL(string: "https://europe-central2-named-vine-322614.cloudfunctions.net/socialAction")!

    let pin: String

    static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        let withMs = ISO8601DateFormatter()
        withMs.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let plain = ISO8601DateFormatter()
        d.dateDecodingStrategy = .custom { dec in
            let s = try dec.singleValueContainer().decode(String.self)
            if let date = withMs.date(from: s) ?? plain.date(from: s) { return date }
            throw DecodingError.dataCorrupted(.init(codingPath: dec.codingPath, debugDescription: "Bad date \(s)"))
        }
        return d
    }()

    static func iso(_ date: Date) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.string(from: date)
    }

    func call<T: Decodable>(_ action: String, _ params: [String: Any] = [:], as: T.Type = T.self) async throws -> T {
        var data = params
        data["action"] = action
        data["pin"] = pin
        var req = URLRequest(url: Self.endpoint, timeoutInterval: 60)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["data": data])

        let body: Data
        do {
            (body, _) = try await URLSession.shared.data(for: req)
        } catch {
            throw APIError(message: "Немає зв'язку з сервером. Перевірте інтернет.", status: nil)
        }
        guard let json = try? JSONSerialization.jsonObject(with: body) as? [String: Any] else {
            throw APIError(message: "Сервер відповів незрозуміло. Спробуйте ще раз.", status: nil)
        }
        if let err = json["error"] as? [String: Any] {
            let status = err["status"] as? String
            let msg = err["message"] as? String
            throw APIError(message: status == "INTERNAL" || msg == nil ? "Помилка сервера. Спробуйте ще раз." : msg!, status: status)
        }
        let result = try JSONSerialization.data(withJSONObject: json["result"] ?? [:], options: .fragmentsAllowed)
        return try Self.decoder.decode(T.self, from: result)
    }

    // MARK: - Actions

    struct LoginResult: Decodable { let accounts: Accounts; let me: Me? }
    struct PostsResult: Decodable { let items: [Post]; let me: Me; let accounts: Accounts }
    struct TeamResult: Decodable { let members: [Member]; let pin: String? }
    struct UploadFile: Decodable { let path: String; let contentType: String; let url: URL }
    struct UploadResult: Decodable { let draftId: String; let files: [UploadFile] }
    struct CreateResult: Decodable { let id: String }
    struct OK: Decodable {}

    func login() async throws -> LoginResult { try await call("login") }

    func posts() async throws -> PostsResult { try await call("posts") }

    func upload(kinds: [MediaFile.Kind]) async throws -> UploadResult {
        try await call("upload", ["files": kinds.map(\.rawValue)])
    }

    func create(draftId: String, post: [String: Any]) async throws -> String {
        try await call("create", ["draftId": draftId, "post": post], as: CreateResult.self).id
    }

    func update(id: String, fields: [String: Any]) async throws -> Post {
        var p = fields
        p["id"] = id
        return try await call("update", p)
    }

    func publishNow(id: String) async throws -> Post { try await call("now", ["id": id]) }

    func remove(id: String) async throws { _ = try await call("remove", ["id": id], as: OK.self) }

    func connect(_ platform: Platform, token: String, accountId: String? = nil) async throws -> Accounts {
        var p: [String: Any] = ["platform": platform.rawValue, "token": token]
        if let accountId, !accountId.isEmpty { p["accountId"] = accountId }
        return try await call("connect", p, as: LoginResult.self).accounts
    }

    func disconnect(_ platform: Platform) async throws -> Accounts {
        try await call("disconnect", ["platform": platform.rawValue], as: LoginResult.self).accounts
    }

    func team() async throws -> TeamResult { try await call("team") }

    func addMember(name: String, role: Role) async throws -> TeamResult {
        try await call("addMember", ["name": name, "role": role.rawValue])
    }

    func resetPin(id: String) async throws -> TeamResult { try await call("resetPin", ["id": id]) }

    func removeMember(id: String) async throws -> TeamResult { try await call("removeMember", ["id": id]) }

    /// PUT straight to the bucket through the signed link; reports bytes sent.
    static func put(file: URL, to url: URL, contentType: String, progress: @escaping @Sendable (Int64) -> Void) async throws {
        var req = URLRequest(url: url, timeoutInterval: 600)
        req.httpMethod = "PUT"
        req.setValue(contentType, forHTTPHeaderField: "Content-Type")
        let delegate = UploadProgress(onSent: progress)
        let (_, resp) = try await URLSession.shared.upload(for: req, fromFile: file, delegate: delegate)
        guard let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw APIError(message: "Не вдалося завантажити файл. Спробуйте ще раз.", status: nil)
        }
    }
}

private final class UploadProgress: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    let onSent: @Sendable (Int64) -> Void
    init(onSent: @escaping @Sendable (Int64) -> Void) { self.onSent = onSent }
    func urlSession(_ session: URLSession, task: URLSessionTask, didSendBodyData bytesSent: Int64, totalBytesSent: Int64, totalBytesExpectedToSend: Int64) {
        onSent(totalBytesSent)
    }
}
