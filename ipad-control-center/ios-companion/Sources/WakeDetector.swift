import Foundation

// Mac-en sover om morgenen, og det er nettopp da signalet oppstår. Tidspunktet
// skrives derfor til disk med én gang og sendes på nytt ved hver senere
// anledning, til panelet tar imot det. Planen er en ren funksjon av
// oppvåkningstidspunktet, så et signal som kommer fram tre timer for sent gir
// nøyaktig samme dag som ett som kom fram med det samme.
@MainActor
final class WakeDetector {
    static let shared = WakeDetector()

    private let defaults = UserDefaults.standard
    private let lastActiveKey = "wakeLastActiveAt"
    private let reportedDayKey = "wakeReportedDay"
    // En kø, ikke ett tidspunkt. Mac-en kan sove i dagevis, og en natt som ikke
    // ble levert er fortsatt en natt — den skal ligge her til den kommer fram.
    private let queueKey = "wakePendingNights"
    private let maxQueued = 90

    // Fire timer stille er ikke en pause, det er en natt. Vinduet 04–13 holder
    // en lang ettermiddagslur utenfor.
    private let quietGap: TimeInterval = 4 * 60 * 60
    private let window = 4...13

    private init() {}

    func noteActivity(now: Date = .now) {
        defer { defaults.set(now, forKey: lastActiveKey) }
        guard let candidate = detect(now: now) else { return }
        defaults.set(dayKey(candidate), forKey: reportedDayKey)
        // Den siste aktiviteten før stillheten er omtrent da telefonen ble lagt
        // fra seg. Det er ikke det samme som å ha sovnet, og panelet merker det
        // som et anslag — men det er begge endene av natta uten at Ole gjør noe.
        let formatter = ISO8601DateFormatter()
        var entry: [String: String] = ["date": isoDay(candidate), "wokeAt": formatter.string(from: candidate)]
        if let lastActive = defaults.object(forKey: lastActiveKey) as? Date {
            entry["sleepAt"] = formatter.string(from: lastActive)
            // Om leggetiden ble ignorert avgjøres kvelden før, mens Mac-en godt
            // kan ha sovet. Svaret følger med natta i stedet for å gå tapt.
            let kveld = SleepAlarms.shared.tonight()
            entry["ignoredBedtime"] = BedtimeWatch.shared.ignoredBedtime(rule: kveld.rule, now: lastActive) ? "1" : "0"
        }
        var queue = defaults.array(forKey: queueKey) as? [[String: String]] ?? []
        queue.removeAll { $0["date"] == entry["date"] }
        queue.append(entry)
        defaults.set(Array(queue.suffix(maxQueued)), forKey: queueKey)
        Task { await flushPending() }
    }

    func detect(now: Date = .now) -> Date? {
        let hour = Calendar.current.component(.hour, from: now)
        guard window.contains(hour) else { return nil }
        guard defaults.string(forKey: reportedDayKey) != dayKey(now) else { return nil }
        guard let lastActive = defaults.object(forKey: lastActiveKey) as? Date else { return nil }
        guard now.timeIntervalSince(lastActive) >= quietGap else { return nil }
        return now
    }

    func flushPending() async {
        var queue = defaults.array(forKey: queueKey) as? [[String: String]] ?? []
        guard !queue.isEmpty, let target = WakeDetector.shared.dayPlanURL() else { return }
        let today = isoDay(.now)
        var levert: [String] = []
        for entry in queue {
            guard let date = entry["date"], let wokeAt = entry["wokeAt"] else { continue }
            // Dagens natt legger også dagen ut på nytt. Etterslepet skal bare
            // inn i historikken, og panelet avviser en oppvåkning som ikke er
            // fra i dag — derfor to ulike kall.
            var body: [String: Any] = date == today
                ? ["kind": "wake", "source": "usage", "wokeAt": wokeAt]
                : ["kind": "night", "date": date, "wokeAt": wokeAt]
            if let sleepAt = entry["sleepAt"] { body["sleepAt"] = sleepAt }
            if entry["ignoredBedtime"] == "1" { body["ignoredBedtime"] = true }
            if await post(body, to: target) { levert.append(date) }
        }
        queue.removeAll { levert.contains($0["date"] ?? "") }
        defaults.set(queue, forKey: queueKey)
    }

    private func post(_ body: [String: Any], to url: URL) async -> Bool {
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 8
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        guard let (_, response) = try? await URLSession.shared.data(for: request),
              let http = response as? HTTPURLResponse, http.statusCode == 200 else { return false }
        return true
    }

    private func isoDay(_ date: Date) -> String {
        let parts = Calendar.current.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }

    // Endepunktet ligger ved siden av det companion allerede sender til, og
    // arver den samme begrensningen på hvilke verter appen snakker med.
    func dayPlanURL() -> URL? {
        guard let endpoint = defaults.string(forKey: "panelEndpoint"),
              let url = URL(string: endpoint),
              url.host?.hasSuffix(".local") == true || url.host?.isPrivateNetworkAddress == true else { return nil }
        return url.deletingLastPathComponent().appendingPathComponent("day-plan")
    }

    private func dayKey(_ date: Date) -> String {
        let parts = Calendar.current.dateComponents([.year, .month, .day], from: date)
        return "\(parts.year ?? 0)-\(parts.month ?? 0)-\(parts.day ?? 0)"
    }
}
