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

    // To adresser, ikke én: hjemmenettet svarer raskest når telefonen er hjemme,
    // tailnettet er det eneste som svarer resten av døgnet. Rekkefølgen og
    // gyldigheten avgjøres i `PanelEndpoint`, som WakeDetector og SleepAlarms
    // deler med denne.
    @Published var endpoint = PanelEndpoint.primary
    @Published var fallbackEndpoint = PanelEndpoint.fallback
    @Published private(set) var deliveredTo = PanelEndpoint.lastGoodHost
    @Published private(set) var screenTimeStatus = "Ikke godkjent"
    @Published private(set) var stepsStatus = "Ikke godkjent"
    @Published private(set) var locationStatus = "Ikke godkjent"
    // Lest fra disk, ikke fra minnet. Appen blir relansert i bakgrunnen og dør
    // igjen; sto disse bare i minnet, var de tomme hver gang Ole faktisk så etter.
    @Published private(set) var lastSync = SyncJournal.lastSuccess?.at
    @Published private(set) var lastAttempt = SyncJournal.lastAttempt
    @Published private(set) var errorMessage: String?
    @Published private(set) var isSyncing = false
    @Published private(set) var backgroundDeliveryStatus = "Ikke slått på ennå"

    // En synk som har stått lenger enn dette har ikke krav på plassen lenger.
    // Fristen er romslig nok til at en treg, men levende, kjøring får gjøre seg
    // ferdig i fred.
    private static let syncDeadline: TimeInterval = 90
    private static let retryNormal: TimeInterval = 30 * 60
    // En feilet synk skyldes nesten alltid at Mac-en sov eller at telefonen var
    // ute av hjemmenettet. Begge deler går over av seg selv, så da er det verdt
    // å be om en ny sjanse snart framfor å vente en halvtime.
    private static let retrySoon: TimeInterval = 5 * 60

    private let healthStore = HKHealthStore()
    private let locationProvider = LocationProvider()
    private var stepsObserverQuery: HKObserverQuery?
    private var syncStartedAt: Date?
    private var deliveryFailure: String?
    private var syncGeneration = 0

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
                    // Skrittene kommer inn i bakgrunnen, og natta ligger i
                    // tidsstemplene deres. Det er her søvnrytmen får vite noe
                    // uten at Ole åpner appen.
                    await WakeDetector.shared.evaluateFromHealth()
                    await SleepAlarms.shared.refresh()
                    observerCompletion.call()
                }
            }
            stepsObserverQuery = query
            healthStore.execute(query)
        }
        // Første forsøk kan skje før brukeren har godkjent Helse. Metoden
        // kalles derfor også rett etter tillatelsesdialogen og ved hver oppstart.
        //
        // Svaret ble tidligere kastet. Sier iOS nei — fordi Helse ikke er
        // godkjent, eller fordi appen er sveipet vekk fra app-veksleren — er det
        // nettopp da panelet blir stående stille, og da skal grunnen stå å lese
        // i appen framfor å være noe man gjetter seg til en uke senere.
        healthStore.enableBackgroundDelivery(for: stepType, frequency: .hourly) { enabled, error in
            Task { @MainActor [weak self] in
                self?.backgroundDeliveryStatus = enabled
                    ? "På · hver time"
                    : (error?.localizedDescription ?? "Av")
            }
        }
    }

    func connectAndSync() async {
        await refreshAll(requestPermissions: true)
    }

    func refreshAll(requestPermissions: Bool) async {
        // Flagget alene var en enveisdør. Sto én synk fast — og opplastingen
        // hadde ingen egen frist, så den kunne stå i minutter — ble `isSyncing`
        // aldri satt tilbake, og hver senere automatiske synk snudde i døra uten
        // å ha forsøkt noe som helst. Panelet så da nøyaktig ut som om telefonen
        // aldri hadde ringt. Derfor har flagget nå en frist: er den gått ut,
        // regnes kjøringen som død og den nye overtar plassen.
        if isSyncing, let startedAt = syncStartedAt, Date.now.timeIntervalSince(startedAt) < Self.syncDeadline {
            // Den tidlige returen lå også utenfor `defer` og planla ingenting.
            // Møttes to synker på feil sekund, tok de bakgrunnskjeden med seg.
            scheduleBackgroundRefresh()
            return
        }
        syncGeneration += 1
        let generation = syncGeneration
        // «Noe kom fram» og «alt gikk bra» er to spørsmål. En kilde som svikter
        // mens resten leveres er ikke en feilet levering, og skal ikke få
        // journalen til å påstå at panelet ikke har hørt fra telefonen.
        deliveryFailure = nil
        isSyncing = true
        syncStartedAt = .now
        // Feilmeldingen sto tidligere `nil` her. Det slettet forrige utfall før
        // det nye fantes, så et blikk i appen var nok til å viske ut grunnen til
        // at panelet sto stille. Den blir stående til denne kjøringen har et svar.
        // Neste bakgrunnskjøring må planlegges uansett utfall. Lå kallet bare på
        // suksessgrenen, døde kjeden for godt første gang en synk feilet — for
        // eksempel når telefonen var utenfor hjemmenettet og .local-adressen
        // ikke svarte. Da våknet appen aldri igjen av seg selv.
        defer {
            // Bare den nyeste kjøringen rydder. En fastlåst synk som endelig gir
            // opp skal ikke slå av flagget under den som allerede har overtatt.
            if generation == syncGeneration {
                isSyncing = false
                syncStartedAt = nil
                // Sto adressen igjen fra forrige gang, ville raden i appen si
                // «levert til hjemmenettet» også etter at hjemmenettet sluttet
                // å svare. Den skal si hva som gjelder nå.
                deliveredTo = PanelEndpoint.lastGoodHost
                // Utfallet skrives når kjøringen er ferdig, ikke når den starter.
                // Det er det eneste tidspunktet det finnes et utfall å skrive.
                SyncJournal.record(failure: deliveryFailure, host: deliveredTo)
                lastAttempt = SyncJournal.lastAttempt
                lastSync = SyncJournal.lastSuccess?.at
            }
            scheduleBackgroundRefresh(after: errorMessage == nil ? Self.retryNormal : Self.retrySoon)
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
            // Delvis sendt er ikke det samme som vellykket. Sto feltet tomt her,
            // ville en kilde som svikter hver gang aldri bli nevnt med et ord.
            errorMessage = problems.isEmpty ? nil : problems.joined(separator: " · ")
        } catch {
            errorMessage = error.localizedDescription
            deliveryFailure = error.localizedDescription
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
        // Adressene lagres før forsøket, ikke etter. Skrives de bare ved en
        // vellykket synk, ville en adresse Ole nettopp har rettet opp i vært
        // glemt igjen neste gang appen startet — nettopp i den situasjonen der
        // den var feil.
        PanelEndpoint.primary = endpoint
        PanelEndpoint.fallback = fallbackEndpoint
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
        try await PanelEndpoint.send(
            path: "device-metrics",
            method: "POST",
            body: JSONEncoder.panelEncoder.encode(payload)
        )
    }

    func scheduleBackgroundRefresh(after delay: TimeInterval = MetricsSyncModel.retryNormal) {
        let request = BGAppRefreshTaskRequest(identifier: Self.backgroundTaskIdentifier)
        request.earliestBeginDate = Date(timeIntervalSinceNow: delay)
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

// Vertssjekken lå her som en `String`-utvidelse WakeDetector lånte. Den bor nå i
// `PanelEndpoint` sammen med rekkefølgen adressene prøves i, slik at det finnes
// ett svar på «hvem snakker appen med» og ikke to som kan drive fra hverandre.
enum SyncError: LocalizedError {
    case healthUnavailable
    case screenTimeDataAccessRequired
    case nothingToSend

    var errorDescription: String? {
        switch self {
        case .healthUnavailable: "Helsedata er ikke tilgjengelig på denne enheten."
        case .screenTimeDataAccessRequired: "Gi full tilgang til app- og nettstedbruk for å hente nøyaktig skjermtid."
        case .nothingToSend: "Ingen av kildene svarte, så det var ingenting å sende."
        }
    }
}
