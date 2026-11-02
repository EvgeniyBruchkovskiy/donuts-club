import SwiftUI

struct QueueView: View {
    @Environment(AppModel.self) private var model
    let compose: () -> Void

    private var failed: [Post] { model.upcoming.filter { $0.status == .failed } }
    private var waiting: [Post] { model.upcoming.filter { $0.status != .failed } }

    var body: some View {
        List {
            if model.accounts.instagram == nil && model.accounts.threads == nil, model.me?.isAdmin == true {
                Section {
                    NavigationLink(destination: SettingsView()) {
                        Label("Підключіть Instagram і Threads, щоб публікувати", systemImage: "link.badge.plus")
                            .font(.subheadline.weight(.semibold))
                    }
                }
            }
            if !failed.isEmpty {
                Section("Потребують уваги") {
                    ForEach(failed) { post in
                        NavigationLink(value: post) { PostRow(post: post) }
                    }
                }
            }
            ForEach(days(waiting), id: \.0) { day, posts in
                Section(dayTitle(day)) {
                    ForEach(posts) { post in
                        NavigationLink(value: post) { PostRow(post: post) }
                    }
                }
            }
        }
        .overlay {
            if model.upcoming.isEmpty, !model.loading {
                ContentUnavailableView {
                    Label("Нічого не заплановано", systemImage: "calendar.badge.plus")
                } description: {
                    Text(model.me?.canEdit == false ? "Тут з'являться публікації, які заплановує команда." : "Створіть пост, Reels або сторіс — він вийде сам у вказаний час.")
                } actions: {
                    if model.me?.canEdit != false {
                        Button("Новий пост", action: compose).buttonStyle(.borderedProminent)
                    }
                }
            }
        }
        .navigationTitle("Заплановані")
        .navigationDestination(for: Post.self) { PostDetailView(postId: $0.id) }
        .toolbar {
            if model.me?.canEdit != false {
                ToolbarItem(placement: .primaryAction) {
                    Button(action: compose) { Image(systemName: "plus.circle.fill").font(.title2) }
                        .accessibilityLabel("Новий пост")
                }
            }
        }
        .refreshable { await model.refresh() }
        .safeAreaInset(edge: .bottom) { ErrorBanner() }
    }
}

struct HistoryView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        List {
            ForEach(days(model.published, by: { $0.publishedAt ?? $0.scheduledAt }).reversed(), id: \.0) { day, posts in
                Section(dayTitle(day)) {
                    ForEach(posts) { post in
                        NavigationLink(value: post) { PostRow(post: post) }
                    }
                }
            }
        }
        .overlay {
            if model.published.isEmpty, !model.loading {
                ContentUnavailableView("Ще нічого не опубліковано", systemImage: "checkmark.seal")
            }
        }
        .navigationTitle("Опубліковані")
        .navigationDestination(for: Post.self) { PostDetailView(postId: $0.id) }
        .refreshable { await model.refresh() }
        .safeAreaInset(edge: .bottom) { ErrorBanner() }
    }
}

struct ErrorBanner: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        if let error = model.error {
            Label(error, systemImage: "wifi.exclamationmark")
                .font(.footnote.weight(.medium))
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(.regularMaterial, in: Capsule())
                .padding(.bottom, 8)
                .onTapGesture { Task { await model.refresh() } }
        }
    }
}

struct PostRow: View {
    let post: Post

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Thumb(post: post, size: 56)
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(post.scheduledAt, format: .dateTime.hour().minute())
                        .font(.rounded(.subheadline))
                        .monospacedDigit()
                    Text(post.kind.title).font(.caption).foregroundStyle(.secondary)
                    Spacer(minLength: 0)
                    StatusChip(post: post)
                }
                Text(preview)
                    .font(.subheadline)
                    .foregroundStyle(preview.isEmpty ? .secondary : .primary)
                    .lineLimit(2)
                HStack(spacing: 8) {
                    PlatformBadges(post: post)
                    if let by = post.createdBy {
                        Text("\(Image(systemName: "person.fill")) \(by)").font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
            }
        }
        .padding(.vertical, 2)
    }

    private var preview: String {
        let t = post.caption.isEmpty ? (post.threadsText ?? "") : post.caption
        return t.isEmpty ? (post.kind == .story ? "Сторіс" : "Без тексту") : t
    }
}

struct Thumb: View {
    let post: Post
    let size: CGFloat

    var body: some View {
        ZStack {
            if let data = post.thumbData, let img = UIImage(data: data) {
                Image(uiImage: img).resizable().scaledToFill()
            } else {
                Color.dough.opacity(0.25)
                Image(systemName: post.kind.symbol).foregroundStyle(Color.choco)
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(alignment: .bottomTrailing) {
            if post.mediaCount > 1 || post.kind == .video {
                Image(systemName: post.kind == .video ? "play.fill" : "square.on.square")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(.white)
                    .padding(4)
                    .background(.black.opacity(0.45), in: Circle())
                    .padding(3)
            }
        }
    }
}

struct PlatformBadges: View {
    let post: Post
    var body: some View {
        HStack(spacing: 6) {
            ForEach(post.platforms) { p in
                let state = post.result(p)?.state
                HStack(spacing: 3) {
                    Image(systemName: icon(state))
                    Text(p.title)
                }
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(color(state))
                    .padding(.horizontal, 7)
                    .padding(.vertical, 3)
                    .background(color(state).opacity(0.12), in: Capsule())
            }
        }
    }

    private func icon(_ s: PlatformResult.State?) -> String {
        switch s {
        case .published: "checkmark.circle.fill"
        case .failed: "exclamationmark.triangle.fill"
        case .processing: "arrow.triangle.2.circlepath"
        default: "clock"
        }
    }

    private func color(_ s: PlatformResult.State?) -> Color {
        switch s {
        case .published: .green
        case .failed: .red
        case .processing: .orange
        default: .secondary
        }
    }
}

struct StatusChip: View {
    let post: Post
    var body: some View {
        switch post.status {
        case .publishing:
            ProgressView().controlSize(.mini)
        case .failed:
            Image(systemName: "exclamationmark.circle.fill").foregroundStyle(.red)
        case .published:
            Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
        case .scheduled:
            EmptyView()
        }
    }
}

// MARK: - Day grouping

func days(_ posts: [Post], by date: (Post) -> Date = { $0.scheduledAt }) -> [(Date, [Post])] {
    let cal = Calendar.current
    let groups = Dictionary(grouping: posts) { cal.startOfDay(for: date($0)) }
    return groups.keys.sorted().map { day in (day, groups[day]!.sorted { date($0) < date($1) }) }
}

func dayTitle(_ day: Date) -> String {
    let cal = Calendar.current
    if cal.isDateInToday(day) { return "Сьогодні" }
    if cal.isDateInTomorrow(day) { return "Завтра" }
    if cal.isDateInYesterday(day) { return "Вчора" }
    return day.formatted(.dateTime.weekday(.wide).day().month(.wide).locale(Locale(identifier: "uk_UA")))
}
