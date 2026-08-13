import BackgroundTasks
import SwiftUI

@main
struct PanelCompanionApp: App {
    @StateObject private var syncModel = MetricsSyncModel()
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
            await syncModel.scheduleBackgroundRefresh()
        }
    }
}
