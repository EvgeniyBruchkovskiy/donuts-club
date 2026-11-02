import SwiftUI

struct RootView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.scenePhase) private var phase
    @State private var composing = false

    var body: some View {
        TabView {
            NavigationStack {
                QueueView(compose: { composing = true })
            }
            .tabItem { Label("Заплановані", systemImage: "calendar") }

            NavigationStack {
                HistoryView()
            }
            .tabItem { Label("Опубліковані", systemImage: "checkmark.seal") }

            NavigationStack {
                SettingsView()
            }
            .tabItem { Label("Налаштування", systemImage: "gearshape") }
        }
        .sheet(isPresented: $composing) {
            ComposerView()
                .interactiveDismissDisabled(model.sending != nil)
        }
        .sheet(item: Binding(get: { model.openPost.map(OpenPost.init) }, set: { model.openPost = $0?.id })) { p in
            NavigationStack {
                PostDetailView(postId: p.id)
                    .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Готово") { model.openPost = nil } } }
            }
            .task { await model.refresh() }
        }
        .task { await model.refresh() }
        .onChange(of: phase) { _, p in
            if p == .active { Task { await model.refresh() } }
        }
        // While something is going out, keep the statuses fresh.
        .task(id: model.posts.map(\.status)) {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(20))
                let soon = model.posts.contains { $0.status == .publishing || ($0.status == .scheduled && $0.scheduledAt < .now.addingTimeInterval(60)) }
                if soon, phase == .active { await model.refresh() }
            }
        }
    }
}

/// A post opened from a push notification.
private struct OpenPost: Identifiable {
    let id: String
}
