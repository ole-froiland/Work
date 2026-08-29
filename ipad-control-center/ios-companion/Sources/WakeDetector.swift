import Foundation
import HealthKit

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
        record(wokeAt: candidate, sleptAt: defaults.object(forKey: lastActiveKey) as? Date)
        Task { await flushPending() }
    }

    // Én vei inn i køen, brukt både av forgrunnen og av helsedataene. To veier
    // ville før eller siden notert natta på hver sin måte.
    func record(wokeAt: Date, sleptAt: Date?) {
        let dag = isoDay(wokeAt)
        guard defaults.string(forKey: reportedDayKey) != dag else { return }
        defaults.set(dag, forKey: reportedDayKey)

        let formatter = ISO8601DateFormatter()
        var entry: [String: String] = ["date": dag, "wokeAt": formatter.string(from: wokeAt)]
        if let sleptAt {
            entry["sleepAt"] = formatter.string(from: sleptAt)
            // Om leggetiden ble ignorert avgjøres kvelden før, mens Mac-en godt
            // kan ha sovet. Svaret følger med natta i stedet for å gå tapt.
            entry["ignoredBedtime"] = BedtimeWatch.shared.ignoredBedtime(rule: SleepAlarms.shared.tonight().rule, now: sleptAt) ? "1" : "0"
        }
        var queue = defaults.array(forKey: queueKey) as? [[String: String]] ?? []
        queue.removeAll { $0["date"] == entry["date"] }
        queue.append(entry)
        defaults.set(Array(queue.suffix(maxQueued)), forKey: queueKey)
    }

    // Å åpne denne appen er et dårlig mål på «Ole brukte telefonen». Gjør han
    // det én gang i uka, blir den ene gangen til hele natta. Skrittene har
    // derimot ekte tidsstempler, og HealthKit leverer dem i bakgrunnen uten at
    // appen åpnes — så natta finnes i dataene enten Ole rører appen eller ei.
    //
    // Et opphold på fire timer eller mer, som ender i vinduet 04–13, er en natt.
    // Enden er da han sto opp, og starten er da han la fra seg telefonen.
    func evaluateFromHealth() async {
        guard HKHealthStore.isHealthDataAvailable(),
              let stepType = HKQuantityType.quantityType(forIdentifier: .stepCount) else { return }
        let store = HKHealthStore()
        let fra = Date.now.addingTimeInterval(-36 * 60 * 60)
        let predikat = HKQuery.predicateForSamples(withStart: fra, end: .now)
        let sortering = [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)]

        let prøver: [HKSample] = await withCheckedContinuation { fortsettelse in
            let spørring = HKSampleQuery(sampleType: stepType, predicate: predikat, limit: HKObjectQueryNoLimit, sortDescriptors: sortering) { _, resultat, _ in
                fortsettelse.resume(returning: resultat ?? [])
            }
            store.execute(spørring)
        }
        guard prøver.count > 1 else { return }

        var sisteSlutt = prøver[0].endDate
        var natt: (sov: Date, våknet: Date)?
        for prøve in prøver.dropFirst() {
            let opphold = prøve.startDate.timeIntervalSince(sisteSlutt)
            let time = Calendar.current.component(.hour, from: prøve.startDate)
            if opphold >= quietGap, window.contains(time) {
                natt = (sov: sisteSlutt, våknet: prøve.startDate)
            }
            sisteSlutt = max(sisteSlutt, prøve.endDate)
        }
        guard let natt else { return }
        record(wokeAt: natt.våknet, sleptAt: natt.sov)
        await flushPending()
    }

    func detect(now: Date = .now) -> Date? {
        let hour = Calendar.current.component(.hour, from: now)
        guard window.contains(hour) else { return nil }
        guard defaults.string(forKey: reportedDayKey) != isoDay(now) else { return nil }
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
}
