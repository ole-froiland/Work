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
                    WakeDetector.shared.noteActivity()
                    BedtimeWatch.shared.noteActivity(targetBedtime: SleepAlarms.shared.tonight().bedtime)
                    Task { await syncModel.refreshAll(requestPermissions: false) }
                    Task { await SleepAlarms.shared.refresh() }
                }
        }
        .backgroundTask(.appRefresh(MetricsSyncModel.backgroundTaskIdentifier)) {
            // Oppvåkningen kan ha oppstått mens Mac-en sov. Den prøves på nytt
            // her, før alt annet, siden dagen ellers står feil til appen åpnes.
            await WakeDetector.shared.evaluateFromHealth()
            await WakeDetector.shared.flushPending()
            await SleepAlarms.shared.refresh()
            await syncModel.refreshAll(requestPermissions: false)
        }
    }
}
