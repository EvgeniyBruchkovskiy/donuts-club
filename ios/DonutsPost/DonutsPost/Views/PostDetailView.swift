import SwiftUI

struct PostDetailView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    let postId: String

    @State private var editing = false
    @State private var confirmDelete = false
    @State private var busy = false
    @State private var error: String?

    private var post: Post? { model.posts.first { $0.id == postId } }

    var body: some View {
        if let post {
            List {
                Section {
                    HStack(alignment: .top, spacing: 14) {
                        Thumb(post: post, size: 96)
                        VStack(alignment: .leading, spacing: 6) {
                            Label(post.kind.title, systemImage: post.kind.symbol).font(.subheadline.weight(.semibold))
                            Text(post.scheduledAt, format: .dateTime.weekday(.wide).day().month().hour().minute())
                                .font(.rounded(.headline))
                            Text(statusText(post)).font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                    .padding(.vertical, 4)
                }

                if post.kind.hasCaption {
                    Section(post.threadsText == nil ? "Текст" : "Текст для Instagram") {
                        Text(post.caption.isEmpty ? "Без тексту" : post.caption)
                            .foregroundStyle(post.caption.isEmpty ? .secondary : .primary)
                            .textSelection(.enabled)
                    }
                }
                if let t = post.threadsText {
                    Section("Текст для Threads") { Text(t).textSelection(.enabled) }
                }

                Section("Куди") {
                    ForEach(post.platforms) { p in
                        PlatformResultRow(platform: p, result: post.result(p), status: post.status) { url in openURL(url) }
                    }
                }

                if let error {
                    Section { Text(error).foregroundStyle(.red).font(.footnote) }
                }

                if post.isEditable {
                    Section {
                        Button {
                            run { try await model.publishNow(post) }
                        } label: {
                            Label(post.status == .failed ? "Повторити зараз" : "Опублікувати зараз", systemImage: "paperplane.fill")
                        }
                        Button { editing = true } label: { Label("Змінити текст і час", systemImage: "pencil") }
                    }
                }
                if post.status != .publishing {
                    Section {
                        Button(role: .destructive) { confirmDelete = true } label: {
                            Label(post.status == .published ? "Прибрати з історії" : "Видалити", systemImage: "trash")
                        }
                    } footer: {
                        if post.status == .published { Text("З Instagram і Threads публікація не зникне — лише з цього списку.") }
                    }
                }
            }
            .navigationTitle(post.kind.title)
            .navigationBarTitleDisplayMode(.inline)
            .disabled(busy)
            .overlay { if busy { ProgressView().controlSize(.large) } }
            .refreshable { await model.refresh() }
            .sheet(isPresented: $editing) { EditPostView(post: post) }
            .confirmationDialog("Видалити публікацію?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Видалити", role: .destructive) {
                    run {
                        try await model.remove(post)
                        dismiss()
                    }
                }
            }
        } else {
            ContentUnavailableView("Публікацію видалено", systemImage: "trash")
        }
    }

    private func statusText(_ p: Post) -> String {
        switch p.status {
        case .scheduled: p.scheduledAt <= .now ? "Виходить протягом хвилини" : "Заплановано"
        case .publishing: "Публікується… Meta обробляє медіа"
        case .published: "Опубліковано"
        case .failed: "Не вийшло — дивіться причину нижче"
        }
    }

    private func run(_ work: @escaping () async throws -> Void) {
        busy = true
        error = nil
        Task {
            do { try await work() } catch { self.error = error.localizedDescription }
            busy = false
        }
    }
}

private struct PlatformResultRow: View {
    let platform: Platform
    let result: PlatformResult?
    let status: PostStatus
    let open: (URL) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Label(platform.title, systemImage: platform.symbol).font(.body.weight(.semibold))
                Spacer()
                Text(stateText).font(.subheadline).foregroundStyle(stateColor)
            }
            if let e = result?.error, result?.state == .failed {
                Text(e).font(.footnote).foregroundStyle(.red)
            }
            if let link = result?.permalink, let url = URL(string: link) {
                Button { open(url) } label: { Label("Відкрити публікацію", systemImage: "arrow.up.right.square") }
                    .font(.subheadline)
                    .buttonStyle(.borderless)
            }
        }
        .padding(.vertical, 2)
    }

    private var stateText: String {
        switch result?.state {
        case .published: "Вийшло"
        case .failed: "Помилка"
        case .processing: "Обробка…"
        default: status == .failed ? "Повториться" : "Чекає"
        }
    }

    private var stateColor: Color {
        switch result?.state {
        case .published: .green
        case .failed: .red
        case .processing: .orange
        default: .secondary
        }
    }
}

struct EditPostView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let post: Post

    @State private var caption = ""
    @State private var separateThreads = false
    @State private var threadsText = ""
    @State private var platforms: Set<Platform> = []
    @State private var date = Date.now
    @State private var busy = false
    @State private var error: String?

    /// Platforms can change only while nothing has gone out.
    private var platformsLocked: Bool { post.results.values.contains { $0.state != .pending } }

    var body: some View {
        NavigationStack {
            Form {
                if post.kind.hasCaption {
                    Section {
                        CaptionEditor(text: $caption, placeholder: "Текст публікації", limit: Draft.captionLimit)
                    } header: { Text(separateThreads ? "Текст для Instagram" : "Текст") }
                }
                if platforms.contains(.threads), post.kind != .text, post.kind.hasCaption {
                    Section {
                        Toggle("Окремий текст для Threads", isOn: $separateThreads.animation())
                        if separateThreads {
                            CaptionEditor(text: $threadsText, placeholder: "Текст для Threads", limit: Draft.threadsLimit)
                        }
                    }
                }
                if !platformsLocked, post.kind.platforms.count > 1 {
                    Section("Куди") {
                        ForEach(post.kind.platforms) { p in
                            Toggle(isOn: Binding(get: { platforms.contains(p) }, set: { on in if on { platforms.insert(p) } else { platforms.remove(p) } })) {
                                Label(p.title, systemImage: p.symbol)
                            }
                            .disabled(model.accounts[p] == nil)
                        }
                    }
                }
                Section("Коли") {
                    DatePicker("Дата і час", selection: $date, in: Date.now..., displayedComponents: [.date, .hourAndMinute])
                }
                if let error {
                    Section { Text(error).foregroundStyle(.red).font(.footnote) }
                }
            }
            .navigationTitle("Редагування")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Скасувати") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if busy { ProgressView() } else { Button("Зберегти", action: save).disabled(platforms.isEmpty) }
                }
            }
            .onAppear {
                caption = post.caption
                threadsText = post.threadsText ?? ""
                separateThreads = post.threadsText != nil
                platforms = Set(post.platforms)
                date = max(post.scheduledAt, .now.addingTimeInterval(60))
            }
        }
    }

    private func save() {
        busy = true
        error = nil
        let ordered = Platform.allCases.filter { platforms.contains($0) }
        Task {
            do {
                try await model.update(
                    post,
                    caption: post.kind.hasCaption ? caption : nil,
                    threadsText: separateThreads ? threadsText : "",
                    platforms: platformsLocked ? nil : ordered,
                    scheduledAt: date
                )
                dismiss()
            } catch {
                self.error = error.localizedDescription
            }
            busy = false
        }
    }
}
