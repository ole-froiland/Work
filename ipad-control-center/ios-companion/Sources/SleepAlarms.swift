// AlarmManager er en vanlig klasse uten Sendable, så Swift 6 regner hvert kall
// herfra som at den sendes ut av MainActor. Rammeverket er ennå ikke revidert
// for streng samtidighet, og @preconcurrency er utveien som er laget for det.
@preconcurrency import AlarmKit
import Foundation
import SwiftUI

struct SleepAlarmMetadata: AlarmMetadata {
    let label: String
}

// Rytmen regnes ut på Mac-en, men alarmene må kunne settes når Mac-en sover.
// Derfor huskes den siste rytmen companion fikk. Målet flytter seg høyst et
// kvarter om dagen, så en rytme fra i går er fortsatt riktig nok til å vekke på.
@MainActor
final class SleepAlarms {
    static let shared = SleepAlarms()

    private let defaults = UserDefaults.standard
    private let cachedKey = "sleepAlarmTimes"
    private let scheduledKey = "sleepAlarmIds"
    private let manager = AlarmManager.shared

    private init() {}

    func authorize() async -> Bool {
        do {
            return try await manager.requestAuthorization() == .authorized
        } catch {
            return false
        }
    }

    func refresh() async {
        if let fetched = await fetchTimes() {
            defaults.set(fetched, forKey: cachedKey)
        }
        guard let times = defaults.array(forKey: cachedKey) as? [[String: String]], !times.isEmpty else { return }
        await cancelScheduled()
        var ids: [String] = []
        for entry in times {
            guard let at = entry["at"], let label = entry["label"], let fireDate = nextDate(for: at) else { continue }
            let id = UUID()
            // Stoppknappen lages av systemet. AlarmButton har ingen ferdig
            // variant av den, og alerten uten `stopButton` er den som gjelder.
            let presentation = AlarmPresentation(alert: .init(
                title: LocalizedStringResource(stringLiteral: label)
            ))
            let attributes = AlarmAttributes<SleepAlarmMetadata>(
                presentation: presentation,
                metadata: SleepAlarmMetadata(label: label),
                tintColor: Color.orange
            )
            let configuration = AlarmManager.AlarmConfiguration<SleepAlarmMetadata>.alarm(
                schedule: .fixed(fireDate),
                attributes: attributes
            )
            if (try? await manager.schedule(id: id, configuration: configuration)) != nil {
                ids.append(id.uuidString)
            }
        }
        defaults.set(ids, forKey: scheduledKey)
    }

    // Alarmene settes på nytt hver dag, så gårsdagens må bort først. Uten dette
    // ville de hope seg opp, fem per døgn, til telefonen ringte i ett sett.
    private func cancelScheduled() async {
        guard let ids = defaults.stringArray(forKey: scheduledKey) else { return }
        for value in ids {
            if let id = UUID(uuidString: value) { try? manager.cancel(id: id) }
        }
        defaults.removeObject(forKey: scheduledKey)
    }

    private func nextDate(for clock: String) -> Date? {
        let parts = clock.split(separator: ":").compactMap { Int($0) }
        guard parts.count == 2 else { return nil }
        var components = DateComponents()
        components.hour = parts[0]
        components.minute = parts[1]
        return Calendar.current.nextDate(after: .now, matching: components, matchingPolicy: .nextTime)
    }

    private func fetchTimes() async -> [[String: String]]? {
        guard let url = WakeDetector.shared.dayPlanURL() else { return nil }
        var request = URLRequest(url: url)
        request.timeoutInterval = 8
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              let http = response as? HTTPURLResponse, http.statusCode == 200,
              let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let alarms = payload["alarms"] as? [[String: String]] else { return nil }
        return alarms
    }
}
