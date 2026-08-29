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
    private let pendingKey = "wakePendingAt"

    // Fire timer stille er ikke en pause, det er en natt. Vinduet 04–13 holder
    // en lang ettermiddagslur utenfor.
    private let quietGap: TimeInterval = 4 * 60 * 60
    private let window = 4...13

    private init() {}

    func noteActivity(now: Date = .now) {
        defer { defaults.set(now, forKey: lastActiveKey) }
        guard let candidate = detect(now: now) else { return }
        defaults.set(dayKey(candidate), forKey: reportedDayKey)
        defaults.set(candidate, forKey: pendingKey)
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
        guard let pending = defaults.object(forKey: pendingKey) as? Date else { return }
        // Et tidspunkt fra i går avvises av panelet uansett. Da er det bedre å
        // kaste det her enn å prøve det hver gang appen åpnes resten av uka.
        guard Calendar.current.isDateInToday(pending) else {
            defaults.removeObject(forKey: pendingKey)
            return
        }
        guard let target = dayPlanURL() else { return }
        var request = URLRequest(url: target)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 8
        let formatter = ISO8601DateFormatter()
        request.httpBody = try? JSONSerialization.data(withJSONObject: [
            "kind": "wake",
            "source": "usage",
            "wokeAt": formatter.string(from: pending),
        ])
        guard let (_, response) = try? await URLSession.shared.data(for: request),
              let http = response as? HTTPURLResponse, http.statusCode == 200 else { return }
        defaults.removeObject(forKey: pendingKey)
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
