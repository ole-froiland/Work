import BackgroundTasks
import Combine
import CoreLocation
import DeviceActivity
import FamilyControls
import HealthKit
import ManagedSettings
import SwiftUI
import UIKit

struct MetricsPayload: Encodable {
    struct AppUsage: Encodable { let name: String; let minutes: Double }
    struct ScreenTime: Encodable {
        let socialMinutes: Double
        let socialWeeklyAverageMinutes: Double
        let topApps: [AppUsage]
    }
    struct Steps: Encodable { let today: Double; let weeklyAverage: Double }
    struct Location: Encodable { let label: String; let latitude: Double; let longitude: Double }
    struct Source: Encodable { let provider: String; let observedAt: Date }

    let screenTime: ScreenTime?
    let steps: Steps?
    let location: Location?
    let sources: [String: Source]
    let deviceName: String
}

@MainActor
final class MetricsSyncModel: ObservableObject {
    static let shared = MetricsSyncModel()
    static let backgroundTaskIdentifier = "no.olefroiland.PanelCompanion.refresh"

    @Published var endpoint = UserDefaults.standard.string(forKey: "panelEndpoint")
        ?? "http://Ole-sin-MacBook-Air.local:4173/api/device-metrics"
    @Published private(set) var screenTimeStatus = "Ikke godkjent"
    @Published private(set) var stepsStatus = "Ikke godkjent"
    @Published private(set) var locationStatus = "Ikke godkjent"
    @Published private(set) var lastSync: Date?
    @Published private(set) var errorMessage: String?
    @Published private(set) var isSyncing = false

    private let healthStore = HKHealthStore()
    private let locationProvider = LocationProvider()
    private var stepsObserverQuery: HKObserverQuery?

    // BGAppRefresh er bare et ønske til iOS og kan bli utsatt lenge. Skritt har
    // en bedre, datadrevet vekkemekanisme: HealthKit starter appen når nye
    // skrittprøver kommer inn. Den samme synken tar med posisjon og skjermtid
    // når de kildene er tilgjengelige, mens den vanlige bakgrunnsjobben blir
    // stående som reserve.
    func startAutomaticSync() {
        guard let stepType = HKObjectType.quantityType(forIdentifier: .stepCount) else { return }

        if stepsObserverQuery == nil {
            let query = HKObserverQuery(sampleType: stepType, predicate: nil) { [weak self] _, completion, error in
                guard error == nil else { completion(); return }
                let observerCompletion = ObserverCompletion(completion)
                Task { @MainActor [weak self] in
                    if let self {
                        await self.refreshAll(requestPermissions: false)
                    }
                    observerCompletion.call()
                }
            }
            stepsObserverQuery = query
            healthStore.execute(query)
        }
        // Første forsøk kan skje før brukeren har godkjent Helse. Metoden
        // kalles derfor også rett etter tillatelsesdialogen og ved hver oppstart.
        healthStore.enableBackgroundDelivery(for: stepType, frequency: .hourly) { _, _ in }
    }

    func connectAndSync() async {
        await refreshAll(requestPermissions: true)
    }

    func refreshAll(requestPermissions: Bool) async {
        guard !isSyncing else { return }
        isSyncing = true
        errorMessage = nil
        // Neste bakgrunnskjøring må planlegges uansett utfall. Lå kallet bare på
        // suksessgrenen, døde kjeden for godt første gang en synk feilet — for
        // eksempel når telefonen var utenfor hjemmenettet og .local-adressen
        // ikke svarte. Da våknet appen aldri igjen av seg selv.
        defer {
            isSyncing = false
            scheduleBackgroundRefresh()
        }

        do {
            if requestPermissions {
                try await requestPermissionsForSources()
            }
            // Kildene hentes samtidig, men de deler ikke lenger skjebne. Før sto
            // det `try await (steps, location)`, og da rev den første som feilet
            // med seg de andre: en posisjon som ikke fikk kontakt innendørs
            // stoppet skrittene og skjermtiden også, og panelet gikk tomt på alt
            // sammen samtidig uten at noe forklarte hvorfor.
            async let pendingSteps = fetchStepMetrics()
            async let pendingLocation = locationProvider.currentLocation()

            var problems: [String] = []
            var steps: (today: Double, weeklyAverage: Double)?
            var location: LocationProvider.Value?

            // Statusen skal vise om kilden svarte, ikke om opplastingen gikk
            // gjennom. Sto de på «Ikke godkjent» til etter upload, så det ut som
            // manglende tillatelser når feilen i virkeligheten var adressen.
            do {
                steps = try await pendingSteps
                stepsStatus = "Klar"
            } catch {
                stepsStatus = "Feilet"
                problems.append("Skritt: \(error.localizedDescription)")
            }
            do {
                location = try await pendingLocation
                locationStatus = "Klar"
            } catch {
                locationStatus = "Feilet"
                problems.append("Posisjon: \(error.localizedDescription)")
            }

            #if PANEL_USAGE_EXPORT
            var screenTime: (social: Double, weeklyAverage: Double, topApps: [MetricsPayload.AppUsage])?
            do {
                screenTime = try await fetchScreenTime()
                screenTimeStatus = "Klar"
            } catch {
                screenTimeStatus = "Feilet"
                problems.append("Skjermtid: \(error.localizedDescription)")
            }
            #else
            let screenTime: (social: Double, weeklyAverage: Double, topApps: [MetricsPayload.AppUsage])? = nil
            screenTimeStatus = "Krever Xcode 26.4+"
            #endif

            try await upload(screenTime: screenTime, steps: steps, location: location)
            lastSync = .now
            // Delvis sendt er ikke det samme som vellykket. Sto feltet tomt her,
            // ville en kilde som svikter hver gang aldri bli nevnt med et ord.
            errorMessage = problems.isEmpty ? nil : problems.joined(separator: " · ")
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func requestPermissionsForSources() async throws {
        guard HKHealthStore.isHealthDataAvailable(),
              let stepType = HKObjectType.quantityType(forIdentifier: .stepCount) else {
            throw SyncError.healthUnavailable
        }
        try await healthStore.requestAuthorization(toShare: [], read: [stepType])
        stepsStatus = "Godkjent"
        startAutomaticSync()

        #if PANEL_USAGE_EXPORT
        try await AuthorizationCenter.shared.requestAuthorization(for: .individual)
        guard AuthorizationCenter.shared.authorizationStatus == .approvedWithDataAccess else {
            throw SyncError.screenTimeDataAccessRequired
        }
        screenTimeStatus = "Godkjent"
        #else
        screenTimeStatus = "Krever Xcode 26.4+"
        #endif

        try await locationProvider.requestAuthorization()
        locationStatus = "Godkjent"
    }

    private func fetchStepMetrics() async throws -> (today: Double, weeklyAverage: Double) {
        guard let stepType = HKObjectType.quantityType(forIdentifier: .stepCount) else {
            throw SyncError.healthUnavailable
        }
        let calendar = Calendar.current
        let todayStart = calendar.startOfDay(for: .now)
        let today = try await fetchSteps(stepType, from: todayStart, to: .now)
        var previousSevenDays = 0.0
        for dayOffset in 1...7 {
            let start = calendar.date(byAdding: .day, value: -dayOffset, to: todayStart)!
            let end = calendar.date(byAdding: .day, value: 1, to: start)!
            previousSevenDays += try await fetchSteps(stepType, from: start, to: end)
        }
        return (today, previousSevenDays / 7)
    }

    private func fetchSteps(_ stepType: HKQuantityType, from start: Date, to end: Date) async throws -> Double {
        let predicate = HKQuery.predicateForSamples(withStart: start, end: end)
        return try await withCheckedThrowingContinuation { continuation in
            let query = HKStatisticsQuery(quantityType: stepType, quantitySamplePredicate: predicate, options: .cumulativeSum) { _, statistics, error in
                if let error { continuation.resume(throwing: error); return }
                let value = statistics?.sumQuantity()?.doubleValue(for: .count()) ?? 0
                continuation.resume(returning: value)
            }
            healthStore.execute(query)
        }
    }

    #if PANEL_USAGE_EXPORT
    private func fetchScreenTime() async throws -> (social: Double, weeklyAverage: Double, topApps: [MetricsPayload.AppUsage]) {
        guard AuthorizationCenter.shared.authorizationStatus == .approvedWithDataAccess else {
            throw SyncError.screenTimeDataAccessRequired
        }
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: .now)
        let sevenDaysAgo = calendar.date(byAdding: .day, value: -7, to: today)!
        let yesterday = calendar.date(byAdding: .day, value: -1, to: today)!
        let filter = DeviceActivityFilter(
            segment: .daily(during: DateInterval(start: sevenDaysAgo, end: today)),
            devices: .init([.iPhone, .iPad]),
            applications: [],
            categories: [],
            webDomains: []
        )

        // Dagens totale skjermtid inneholder alt telefonen har vært brukt til.
        // Panelet skal bare måle de sosiale appene, så tiden summeres app for
        // app gjennom filteret i stedet for å lese segmentets totalsum.
        var socialByDay: [Date: TimeInterval] = [:]
        var yesterdayByApp: [String: TimeInterval] = [:]
        for try await deviceData in DeviceActivityData.activityData(filteredBy: filter, using: .live) {
            for try await segment in deviceData.activitySegments {
                let day = calendar.startOfDay(for: segment.dateInterval.start)
                for try await category in segment.categories {
                    for try await application in category.applications {
                        let app = application.application
                        guard SocialApps.isSocial(
                            bundleIdentifier: app.bundleIdentifier,
                            displayName: app.localizedDisplayName
                        ) else { continue }
                        socialByDay[day, default: 0] += application.totalActivityDuration
                        guard day == yesterday else { continue }
                        let name = app.localizedDisplayName ?? app.bundleIdentifier ?? "Ukjent app"
                        yesterdayByApp[name, default: 0] += application.totalActivityDuration
                    }
                }
            }
        }
        let socialMinutes = socialByDay[yesterday, default: 0] / 60
        let weeklyMinutes = socialByDay.values.reduce(0, +) / 60 / 7
        let topApps = yesterdayByApp
            .sorted { $0.value > $1.value }
            .prefix(5)
            .map { MetricsPayload.AppUsage(name: $0.key, minutes: $0.value / 60) }
        return (socialMinutes, weeklyMinutes, topApps)
    }
    #endif

    private func upload(
        screenTime: (social: Double, weeklyAverage: Double, topApps: [MetricsPayload.AppUsage])?,
        steps: (today: Double, weeklyAverage: Double)?,
        location: LocationProvider.Value?
    ) async throws {
        // Sviktet alle tre, er det ingenting å si. Da skal feilen stå igjen fra
        // kildene i stedet for å bli overskrevet av et vellykket tomt kall.
        guard screenTime != nil || steps != nil || location != nil else {
            throw SyncError.nothingToSend
        }
        guard let url = URL(string: endpoint), url.host?.hasSuffix(".local") == true || url.host?.isPrivateNetworkAddress == true else {
            throw SyncError.invalidLocalEndpoint
        }
        UserDefaults.standard.set(endpoint, forKey: "panelEndpoint")
        let now = Date.now
        // Bare kildene som faktisk svarte føres opp. Panelet måler ferskhet per
        // kilde, så en oppføring uten tall bak ville fått resten til å se friskt
        // ut mens tallet manglet.
        var sources: [String: MetricsPayload.Source] = [:]
        if steps != nil { sources["steps"] = .init(provider: "HealthKit", observedAt: now) }
        if let location { sources["location"] = .init(provider: "CoreLocation", observedAt: location.observedAt) }
        if screenTime != nil { sources["screenTime"] = .init(provider: "DeviceActivity", observedAt: now) }
        let payload = MetricsPayload(
            screenTime: screenTime.map { .init(socialMinutes: $0.social, socialWeeklyAverageMinutes: $0.weeklyAverage, topApps: $0.topApps) },
            steps: steps.map { .init(today: $0.today, weeklyAverage: $0.weeklyAverage) },
            location: location.map { .init(label: $0.label, latitude: $0.coordinate.latitude, longitude: $0.coordinate.longitude) },
            sources: sources,
            deviceName: UIDevice.current.name
        )
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder.panelEncoder.encode(payload)
        let (_, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw SyncError.dashboardRejected
        }
    }

    func scheduleBackgroundRefresh() {
        let request = BGAppRefreshTaskRequest(identifier: Self.backgroundTaskIdentifier)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 30 * 60)
        try? BGTaskScheduler.shared.submit(request)
    }
}

// HealthKit gir en vanlig Objective-C completion-blokk, mens Swift 6 krever at
// verdier som flyttes inn i en MainActor-task er Sendable. Blokken kalles
// nøyaktig én gang etter synken; den muterer ingen Swift-tilstand i boksen.
private final class ObserverCompletion: @unchecked Sendable {
    private let completion: () -> Void

    init(_ completion: @escaping () -> Void) {
        self.completion = completion
    }

    func call() {
        completion()
    }
}

private extension JSONEncoder {
    static var panelEncoder: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }
}

private extension String {
    var isPrivateNetworkAddress: Bool {
        self == "localhost" || hasPrefix("192.168.") || hasPrefix("10.") || hasPrefix("172.16.") || hasPrefix("172.17.") || hasPrefix("172.18.") || hasPrefix("172.19.") || hasPrefix("172.2") || hasPrefix("172.30.") || hasPrefix("172.31.")
    }
}

enum SyncError: LocalizedError {
    case healthUnavailable
    case screenTimeDataAccessRequired
    case invalidLocalEndpoint
    case dashboardRejected
    case nothingToSend

    var errorDescription: String? {
        switch self {
        case .healthUnavailable: "Helsedata er ikke tilgjengelig på denne enheten."
        case .screenTimeDataAccessRequired: "Gi full tilgang til app- og nettstedbruk for å hente nøyaktig skjermtid."
        case .invalidLocalEndpoint: "Dashboard-adressen må være en lokal .local- eller privat nettverksadresse."
        case .dashboardRejected: "Dashboardet avviste synkroniseringen. Kontroller at Mac-en og mobilen er på samme nettverk."
        case .nothingToSend: "Ingen av kildene svarte, så det var ingenting å sende."
        }
    }
}
