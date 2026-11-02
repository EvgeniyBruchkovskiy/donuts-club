import SwiftUI

@main
struct DonutsPostApp: App {
    @UIApplicationDelegateAdaptor(PushDelegate.self) private var push
    @State private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            Group {
                if model.pin == nil {
                    LoginView()
                } else {
                    RootView()
                }
            }
            .environment(model)
            .task(id: model.pin) {
                PushDelegate.onToken = { token in Task { await model.registerDevice(token) } }
                PushDelegate.onOpen = { id in model.openPost = id }
                if model.pin != nil { await PushDelegate.start() }
            }
            .tint(.accentColor)
            .environment(\.locale, Locale(identifier: "uk_UA"))
        }
    }
}

/// Brand colours from the site (web/src/styles/main.css).
extension Color {
    static let cream = Color(red: 1, green: 0.965, blue: 0.925)
    static let choco = Color(red: 0.369, green: 0.227, blue: 0.141)
    static let ink = Color(red: 0.231, green: 0.141, blue: 0.082)
    static let mint = Color(red: 0.341, green: 0.831, blue: 0.714)
    static let dough = Color(red: 0.914, green: 0.659, blue: 0.361)
    static let straw = Color(red: 1, green: 0.361, blue: 0.455)
}

extension Font {
    static func rounded(_ style: Font.TextStyle, weight: Font.Weight = .bold) -> Font {
        .system(style, design: .rounded, weight: weight)
    }
}
