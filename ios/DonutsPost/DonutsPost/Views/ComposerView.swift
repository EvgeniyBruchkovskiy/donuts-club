import PhotosUI
import SwiftUI

struct ComposerView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    @State private var draft = Draft()
    @State private var picks: [PhotosPickerItem] = []
    @State private var loadingMedia = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Тип", selection: $draft.kind) {
                        ForEach(PostKind.allCases) { k in Text(k.title).tag(k) }
                    }
                    .pickerStyle(.segmented)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                }

                Section {
                    ForEach(Platform.allCases) { p in platformToggle(p) }
                } header: {
                    Text("Куди")
                } footer: {
                    if draft.kind == .story { Text("Сторіс — лише Instagram.") }
                    if draft.kind == .text { Text("Пост без фото — лише Threads.") }
                }

                if draft.kind.maxMedia > 0 { mediaSection }

                if draft.kind.hasCaption { textSection }

                Section("Коли") {
                    DatePicker("Дата і час", selection: $draft.scheduledAt, in: Date.now.addingTimeInterval(-60)..., displayedComponents: [.date, .hourAndMinute])
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            quick("Зараз", .now)
                            quick("Сьогодні 18:00", at(hour: 18, dayOffset: 0))
                            quick("Завтра 09:00", at(hour: 9, dayOffset: 1))
                            quick("Завтра 12:00", at(hour: 12, dayOffset: 1))
                        }
                    }
                    .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                }

                if !draft.warnings.isEmpty {
                    Section {
                        ForEach(draft.warnings, id: \.self) { w in
                            Label(w, systemImage: "exclamationmark.triangle").font(.footnote).foregroundStyle(.orange)
                        }
                    }
                }
                if let error {
                    Section { Text(error).foregroundStyle(.red).font(.footnote) }
                }
            }
            .navigationTitle("Нова публікація")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Скасувати") {
                        MediaProcessor.clearTemp()
                        dismiss()
                    }
                    .disabled(model.sending != nil)
                }
            }
            .safeAreaInset(edge: .bottom) { sendBar }
            .disabled(model.sending != nil)
            .onChange(of: draft.kind) { old, k in
                draft.platforms = draft.platforms.intersection(k.platforms).union(k.platforms.count == 1 ? Set(k.platforms) : [])
                // Story photos are not cropped, feed photos are — they have to be picked again.
                if (old == .story) != (k == .story) { draft.media = [] }
                if draft.media.count > k.maxMedia { draft.media = Array(draft.media.prefix(k.maxMedia)) }
            }
            .onChange(of: picks) { _, items in load(items) }
            .onAppear {
                // Only connected platforms start switched on.
                let connected = Set(Platform.allCases.filter { model.accounts[$0] != nil })
                if !connected.isEmpty { draft.platforms = connected }
            }
        }
    }

    // MARK: - Sections

    private func platformToggle(_ p: Platform) -> some View {
        let allowed = draft.kind.platforms.contains(p)
        let account = model.accounts[p]
        return Toggle(isOn: Binding(
            get: { allowed && draft.platforms.contains(p) },
            set: { on in if on { draft.platforms.insert(p) } else { draft.platforms.remove(p) } }
        )) {
            HStack(spacing: 12) {
                Image(systemName: p.symbol).frame(width: 24).foregroundStyle(Color.accentColor)
                VStack(alignment: .leading, spacing: 2) {
                    Text(p.title)
                    Text(account.map { "@\($0.username)" } ?? "Не підключено").font(.caption).foregroundStyle(.secondary)
                }
            }
        }
        .disabled(!allowed)
    }

    private var mediaSection: some View {
        Section {
            if !draft.media.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 10) {
                        ForEach(Array(draft.media.enumerated()), id: \.element.id) { i, m in
                            MediaTile(media: m, index: draft.media.count > 1 ? i + 1 : nil,
                                      aspect: draft.kind == .story ? 9.0 / 16 : 4.0 / 5) {
                                draft.media.removeAll { $0.id == m.id }
                            }
                        }
                    }
                    .padding(.vertical, 4)
                }
                .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
            }
            if draft.media.count < draft.kind.maxMedia {
            PhotosPicker(selection: $picks, maxSelectionCount: max(1, draft.kind.maxMedia - draft.media.count), selectionBehavior: .ordered, matching: filter) {
                HStack {
                    Label(draft.media.isEmpty ? "Обрати з галереї" : "Додати ще", systemImage: "photo.on.rectangle.angled")
                    if loadingMedia { Spacer(); ProgressView() }
                }
            }
            .disabled(loadingMedia)
            }
        } header: {
            Text(draft.kind == .carousel ? "Фото і відео (\(draft.media.count)/10)" : "Медіа")
        } footer: {
            if draft.kind == .image || draft.kind == .carousel {
                Text("Фото ширші за 1.91:1 чи вужчі за 4:5 обрізаються по центру — так вимагає Instagram.")
            }
        }
    }

    private var filter: PHPickerFilter {
        switch draft.kind {
        case .image: .images
        case .video: .videos
        default: .any(of: [.images, .videos])
        }
    }

    private var textSection: some View {
        Group {
            Section {
                CaptionEditor(
                    text: $draft.caption,
                    placeholder: draft.kind == .text ? "Що нового в Donuts Club?" : "Текст публікації, хештеги…",
                    limit: draft.kind == .text ? Draft.threadsLimit : Draft.captionLimit
                )
            } header: {
                Text(draft.separateThreads ? "Текст для Instagram" : "Текст")
            } footer: {
                if !draft.separateThreads, draft.kind != .text, draft.chosenPlatforms.contains(.threads), draft.caption.count > Draft.threadsLimit {
                    Text("Для Threads текст задовгий (до 500 символів) — увімкніть окремий текст.").foregroundStyle(.red)
                }
            }
            if draft.kind != .text, draft.chosenPlatforms.contains(.threads), draft.chosenPlatforms.contains(.instagram) {
                Section {
                    Toggle("Окремий текст для Threads", isOn: $draft.separateThreads.animation())
                    if draft.separateThreads {
                        CaptionEditor(text: $draft.threadsText, placeholder: "Коротший текст для Threads", limit: Draft.threadsLimit)
                    }
                }
            }
        }
    }

    private var sendBar: some View {
        VStack(spacing: 8) {
            if let s = model.sending {
                ProgressView(value: s.fraction) { Text(s.step).font(.footnote) }
            } else if let problem = draft.problem {
                Text(problem).font(.footnote).foregroundStyle(.secondary)
            }
            Button(action: send) {
                Text(sendTitle).font(.headline).frame(maxWidth: .infinity, minHeight: 50)
            }
            .buttonStyle(.borderedProminent)
            .buttonBorderShape(.capsule)
            .disabled(draft.problem != nil || model.sending != nil || loadingMedia)
        }
        .padding(.horizontal, 16)
        .padding(.top, 10)
        .padding(.bottom, 6)
        .background(.bar)
    }

    private var sendTitle: String {
        draft.scheduledAt <= .now.addingTimeInterval(60) ? "Опублікувати зараз" : "Запланувати на \(draft.scheduledAt.formatted(.dateTime.day().month().hour().minute()))"
    }

    private func quick(_ title: String, _ date: Date) -> some View {
        Button(title) { draft.scheduledAt = date }
            .font(.footnote.weight(.semibold))
            .buttonStyle(.bordered)
            .buttonBorderShape(.capsule)
            .disabled(date < .now.addingTimeInterval(-60))
    }

    private func at(hour: Int, dayOffset: Int) -> Date {
        let cal = Calendar.current
        let day = cal.date(byAdding: .day, value: dayOffset, to: .now) ?? .now
        return cal.date(bySettingHour: hour, minute: 0, second: 0, of: day) ?? .now
    }

    // MARK: - Actions

    private func load(_ items: [PhotosPickerItem]) {
        guard !items.isEmpty else { return }
        loadingMedia = true
        error = nil
        let kind = draft.kind
        Task {
            for item in items where draft.media.count < kind.maxMedia {
                do {
                    draft.media.append(try await MediaProcessor.load(item, for: kind))
                } catch {
                    self.error = error.localizedDescription
                }
            }
            picks = []
            loadingMedia = false
        }
    }

    private func send() {
        error = nil
        Task {
            do {
                try await model.send(draft)
                dismiss()
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}

struct MediaTile: View {
    let media: MediaFile
    let index: Int?
    let aspect: CGFloat
    let remove: () -> Void

    var body: some View {
        Image(uiImage: media.preview)
            .resizable()
            .scaledToFill()
            .frame(width: 110 * aspect / (4.0 / 5) * 0.9, height: 124)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(alignment: .topTrailing) {
                Button(action: remove) {
                    Image(systemName: "xmark.circle.fill").font(.title3).symbolRenderingMode(.palette).foregroundStyle(.white, .black.opacity(0.5))
                }
                .buttonStyle(.plain)
                .padding(4)
            }
            .overlay(alignment: .bottomLeading) {
                if index != nil || media.duration != nil {
                HStack(spacing: 4) {
                    if let index { Text("\(index)") }
                    if let d = media.duration { Image(systemName: "play.fill"); Text(Duration.seconds(d).formatted(.time(pattern: .minuteSecond))) }
                }
                .font(.caption2.weight(.bold))
                .foregroundStyle(.white)
                .padding(.horizontal, 6)
                .padding(.vertical, 3)
                .background(.black.opacity(0.5), in: Capsule())
                .padding(5)
                }
            }
    }
}

struct CaptionEditor: View {
    @Binding var text: String
    let placeholder: String
    let limit: Int

    var body: some View {
        VStack(alignment: .trailing, spacing: 4) {
            TextField(placeholder, text: $text, axis: .vertical)
                .lineLimit(4...14)
            Text(verbatim: "\(text.count)/\(limit)")
                .font(.caption2.monospacedDigit())
                .foregroundStyle(text.count > limit ? .red : .secondary)
        }
    }
}
