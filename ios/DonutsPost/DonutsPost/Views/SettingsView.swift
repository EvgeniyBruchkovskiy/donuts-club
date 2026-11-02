import SwiftUI

struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @State private var connecting: Platform?
    @State private var confirmLogout = false

    var body: some View {
        List {
            Section {
                ForEach(Platform.allCases) { p in
                    AccountRow(platform: p, account: model.accounts[p]) { connecting = p }
                }
            } header: {
                Text("Акаунти")
            } footer: {
                Text("Токени зберігаються лише на сервері Donuts Club і продовжуються автоматично кожні 5 днів.")
            }

            Section("Як це працює") {
                InfoRow(icon: "clock.badge.checkmark", text: "Публікації виходять самі в заданий час — телефон може бути вимкнений.")
                InfoRow(icon: "arrow.triangle.2.circlepath", text: "Сервер перевіряє чергу щохвилини. Відео Meta обробляє від кількох секунд до кількох хвилин.")
                InfoRow(icon: "trash", text: "Після публікації оригінали видаляються з сервера, лишається мініатюра.")
            }

            Section {
                Button("Вийти", role: .destructive) { confirmLogout = true }
            } footer: {
                Text("Donuts Post \(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "")")
            }
        }
        .navigationTitle("Налаштування")
        .sheet(item: $connecting) { ConnectView(platform: $0) }
        .confirmationDialog("Вийти з додатка?", isPresented: $confirmLogout, titleVisibility: .visible) {
            Button("Вийти", role: .destructive) { model.logout() }
        }
        .refreshable { await model.refresh() }
    }
}

private struct InfoRow: View {
    let icon: String
    let text: String
    var body: some View {
        Label { Text(text).font(.footnote) } icon: { Image(systemName: icon).foregroundStyle(Color.accentColor) }
    }
}

private struct AccountRow: View {
    @Environment(AppModel.self) private var model
    let platform: Platform
    let account: Account?
    let connect: () -> Void
    @State private var confirm = false

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: platform.symbol)
                .font(.title3)
                .frame(width: 36, height: 36)
                .background(Color.accentColor.opacity(0.12), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text(platform.title).font(.body.weight(.semibold))
                if let account {
                    Text("@\(account.username)").font(.subheadline).foregroundStyle(.secondary)
                    if let e = account.refreshError {
                        Text("Не вдалося продовжити токен: \(e)").font(.caption).foregroundStyle(.red)
                    } else if let exp = account.expiresAt, exp < .now.addingTimeInterval(10 * 86400) {
                        Text("Токен діє до \(exp.formatted(date: .abbreviated, time: .omitted))").font(.caption).foregroundStyle(.orange)
                    }
                } else {
                    Text("Не підключено").font(.subheadline).foregroundStyle(.secondary)
                }
            }
            Spacer()
            if account == nil {
                Button("Підключити", action: connect).buttonStyle(.borderedProminent).controlSize(.small)
            } else {
                Menu {
                    Button("Оновити токен", systemImage: "key", action: connect)
                    Button("Відключити", systemImage: "xmark", role: .destructive) { confirm = true }
                } label: {
                    Image(systemName: "ellipsis.circle").font(.title3)
                }
            }
        }
        .padding(.vertical, 2)
        .confirmationDialog("Відключити \(platform.title)?", isPresented: $confirm, titleVisibility: .visible) {
            Button("Відключити", role: .destructive) {
                Task { try? await model.disconnect(platform) }
            }
        } message: {
            Text("Заплановані публікації туди не вийдуть, доки не підключите знову.")
        }
    }
}

struct ConnectView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let platform: Platform
    @State private var token = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("Як отримати токен") {
                    ForEach(Array(steps.enumerated()), id: \.offset) { i, s in
                        HStack(alignment: .firstTextBaseline, spacing: 10) {
                            Text("\(i + 1)").font(.rounded(.footnote)).foregroundStyle(.white)
                                .frame(width: 20, height: 20).background(Color.accentColor, in: Circle())
                            Text(s).font(.footnote)
                        }
                    }
                    Link(destination: URL(string: "https://developers.facebook.com/apps/")!) {
                        Label("Відкрити Meta for Developers", systemImage: "arrow.up.right.square")
                    }
                }
                Section {
                    TextField("Вставте токен", text: $token, axis: .vertical)
                        .lineLimit(2...5)
                        .font(.footnote.monospaced())
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    Button("Вставити з буфера", systemImage: "doc.on.clipboard") {
                        token = UIPasteboard.general.string?.trimmingCharacters(in: .whitespacesAndNewlines) ?? token
                    }
                } header: {
                    Text("Токен доступу \(platform.title)")
                }
                if let error {
                    Section { Text(error).foregroundStyle(.red).font(.footnote) }
                }
            }
            .navigationTitle("Підключити \(platform.title)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Скасувати") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if busy { ProgressView() } else { Button("Підключити", action: save).disabled(token.count < 20) }
                }
            }
        }
    }

    private var steps: [String] {
        switch platform {
        case .instagram:
            [
                "У Meta for Developers відкрийте застосунок Donuts Post → Use cases → «Manage messaging & content on Instagram» → API setup with Instagram login.",
                "У розділі «Generate access tokens» натисніть Add account і увійдіть в Instagram Donuts Club.",
                "Натисніть Generate token біля акаунта, погодьтеся і скопіюйте токен.",
                "Поверніться сюди і вставте його нижче.",
            ]
        case .threads:
            [
                "У Meta for Developers відкрийте застосунок Donuts Post → Use cases → «Access the Threads API» → Settings.",
                "Додайте акаунт Threads Donuts Club у Threads testers і прийміть запрошення в Threads (Налаштування → Акаунт → Website permissions → Invites).",
                "У User Token Generator натисніть Generate access token біля акаунта і скопіюйте токен.",
                "Поверніться сюди і вставте його нижче.",
            ]
        }
    }

    private func save() {
        busy = true
        error = nil
        Task {
            do {
                try await model.connect(platform, token: token.trimmingCharacters(in: .whitespacesAndNewlines))
                dismiss()
            } catch {
                self.error = error.localizedDescription
            }
            busy = false
        }
    }
}
