import SwiftUI

@main struct OpenGymWatchApp: App {
    @StateObject private var model = WatchViewModel()
    var body: some Scene {
        WindowGroup {
            ContentView(model: model)
                .tint(Color(red: 0.55, green: 0.88, blue: 0.34))
        }
    }
}
