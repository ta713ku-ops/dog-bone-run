import SwiftUI

@main
struct DogBoneRunApp: App {
    var body: some Scene {
        WindowGroup {
            GameShellView()
                .ignoresSafeArea()
                .preferredColorScheme(.light)
        }
    }
}
