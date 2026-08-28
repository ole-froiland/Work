import BackgroundTasks
import SwiftUI
import UIKit

final class PanelCompanionDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        MetricsSyncModel.shared.startAutomaticSync()
        return true
    }
}

@main
struct PanelCompanionApp: App {
    @UIApplicationDelegateAdaptor(PanelCompanionDelegate.self) private var appDelegate
    @StateObject private var syncModel = MetricsSyncModel.shared
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            SyncView(model: syncModel)
                .task {
                    if CommandLine.arguments.contains("--connect-and-sync") {
                        if let endpointArgument = CommandLine.arguments.first(where: { $0.hasPrefix("--endpoint=") }) {
                            syncModel.endpoint = String(endpointArgument.dropFirst("--endpoint=".count))
                        }
                        await syncModel.connectAndSync()
                    } else {
                        await syncModel.refreshAll(requestPermissions: false)
                    }
                }
                .onChange(of: scenePhase) { _, newPhase in
                    guard newPhase == .active else { return }
                    Task { await syncModel.refreshAll(requestPermissions: false) }
                }
        }
        .backgroundTask(.appRefresh(MetricsSyncModel.backgroundTaskIdentifier)) {
            await syncModel.refreshAll(requestPermissions: false)
        }
    }
}
