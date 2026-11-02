import SwiftUI

struct LoginView: View {
    @Environment(AppModel.self) private var model
    @State private var pin = ""
    @State private var busy = false
    @State private var error: String?
    @FocusState private var focused: Bool

    var body: some View {
        VStack(spacing: 24) {
            Spacer()
            Image("Logo")
                .resizable()
                .frame(width: 96, height: 96)
                .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
                .shadow(color: .choco.opacity(0.15), radius: 12, y: 6)
            VStack(spacing: 6) {
                Text("Donuts Post")
                    .font(.rounded(.largeTitle, weight: .heavy))
                Text("Відкладені публікації в Instagram і Threads")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            SecureField("PIN", text: $pin)
                .keyboardType(.numberPad)
                .textContentType(.password)
                .multilineTextAlignment(.center)
                .font(.title2.monospacedDigit())
                .padding(.vertical, 14)
                .background(.background, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(.quaternary))
                .frame(maxWidth: 240)
                .focused($focused)
                .onSubmit(submit)
            if let error {
                Text(error).font(.footnote).foregroundStyle(.red).multilineTextAlignment(.center)
            }
            Button(action: submit) {
                Group {
                    if busy { ProgressView().tint(.white) } else { Text("Увійти") }
                }
                .font(.headline)
                .frame(maxWidth: 240, minHeight: 50)
            }
            .buttonStyle(.borderedProminent)
            .buttonBorderShape(.capsule)
            .disabled(pin.count < 4 || busy)
            Spacer()
            Spacer()
        }
        .padding(24)
        .frame(maxWidth: .infinity)
        .background(Color(uiColor: .systemGroupedBackground))
        .onAppear { focused = true }
    }

    private func submit() {
        guard pin.count >= 4, !busy else { return }
        busy = true
        error = nil
        Task {
            do {
                try await model.login(pin)
            } catch {
                self.error = error.localizedDescription
                pin = ""
            }
            busy = false
        }
    }
}
