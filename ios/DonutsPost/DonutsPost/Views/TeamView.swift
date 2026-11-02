import SwiftUI

/// The owner hands out personal PINs: each member signs in with their own, and posts show their name.
struct TeamView: View {
    @Environment(AppModel.self) private var model
    @State private var members: [Member] = []
    @State private var loaded = false
    @State private var adding = false
    @State private var shown: NewPin?
    @State private var error: String?
    @State private var removing: Member?

    struct NewPin: Identifiable {
        let name: String
        let pin: String
        var id: String { pin }
    }

    var body: some View {
        List {
            Section {
                if members.isEmpty, loaded {
                    Text("Поки що тільки ви. Додайте людей зі СММ — кожен отримає свій PIN.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                ForEach(members) { m in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(m.name).font(.body.weight(.semibold))
                            Text(m.role.title).font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Menu {
                            Button("Новий PIN", systemImage: "key") { run { try await reset(m) } }
                            Button("Прибрати з команди", systemImage: "person.badge.minus", role: .destructive) { removing = m }
                        } label: {
                            Image(systemName: "ellipsis.circle").font(.title3)
                        }
                    }
                }
            } footer: {
                Text("PIN показується лише один раз. Забули — видайте новий, старий одразу перестане працювати.")
            }
            if let error {
                Section { Text(error).foregroundStyle(.red).font(.footnote) }
            }
        }
        .navigationTitle("Команда")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { adding = true } label: { Image(systemName: "person.badge.plus") }
                    .accessibilityLabel("Додати людину")
            }
        }
        .overlay { if !loaded { ProgressView() } }
        .task { run { members = try await model.team() } }
        .refreshable { run { members = try await model.team() } }
        .sheet(isPresented: $adding) {
            AddMemberView { r, name in
                members = r.members
                if let pin = r.pin { shown = NewPin(name: name, pin: pin) }
            }
        }
        .sheet(item: $shown) { PinCard(name: $0.name, pin: $0.pin) }
        .confirmationDialog("Прибрати \(removing?.name ?? "")?", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
            Button("Прибрати", role: .destructive) {
                if let m = removing { run { members = try await model.removeMember(m) } }
            }
        } message: {
            Text("Їхній PIN перестане працювати. Заплановані ними публікації залишаться.")
        }
    }

    private func reset(_ m: Member) async throws {
        let r = try await model.resetPin(m)
        members = r.members
        if let pin = r.pin { shown = NewPin(name: m.name, pin: pin) }
    }

    private func run(_ work: @escaping () async throws -> Void) {
        error = nil
        Task {
            do { try await work() } catch { self.error = error.localizedDescription }
            loaded = true
        }
    }
}

private struct AddMemberView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let done: (SocialAPI.TeamResult, String) -> Void
    @State private var name = ""
    @State private var role = Role.editor
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("Ім'я") {
                    TextField("Напр. Оля СММ", text: $name).textInputAutocapitalization(.words)
                }
                Section {
                    Picker("Роль", selection: $role) {
                        ForEach([Role.editor, .viewer]) { r in
                            VStack(alignment: .leading) {
                                Text(r.title)
                                Text(r.hint).font(.caption).foregroundStyle(.secondary)
                            }
                            .tag(r)
                        }
                    }
                    .pickerStyle(.inline)
                    .labelsHidden()
                } header: {
                    Text("Що може")
                }
                if let error {
                    Section { Text(error).foregroundStyle(.red).font(.footnote) }
                }
            }
            .navigationTitle("Нова людина")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Скасувати") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if busy { ProgressView() } else {
                        Button("Додати", action: save).disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }
            }
        }
    }

    private func save() {
        busy = true
        error = nil
        let n = name.trimmingCharacters(in: .whitespacesAndNewlines)
        Task {
            do {
                let r = try await model.addMember(name: n, role: role)
                dismiss()
                done(r, n)
            } catch {
                self.error = error.localizedDescription
            }
            busy = false
        }
    }
}

/// Shown once after a PIN is created; the owner passes it on.
private struct PinCard: View {
    @Environment(\.dismiss) private var dismiss
    let name: String
    let pin: String

    private var message: String {
        "Donuts Post — ваш PIN: \(pin)\nВстановіть застосунок через TestFlight і увійдіть з цим PIN."
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                Spacer()
                Text("PIN для \(name)").font(.headline)
                Text(pin)
                    .font(.system(size: 48, weight: .heavy, design: .rounded).monospacedDigit())
                    .kerning(6)
                    .textSelection(.enabled)
                Text("Запишіть або надішліть зараз — потім його не буде видно.")
                    .font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
                ShareLink(item: message) {
                    Label("Надіслати", systemImage: "square.and.arrow.up").frame(maxWidth: 240, minHeight: 44)
                }
                .buttonStyle(.borderedProminent)
                Button("Скопіювати PIN") { UIPasteboard.general.string = pin }
                Spacer()
                Spacer()
            }
            .padding(24)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Готово") { dismiss() } }
            }
        }
        .interactiveDismissDisabled()
    }
}
