import Foundation

// Å ignorere leggetiden måles ikke på alarmen, men på oppførselen: er telefonen
// fortsatt i bruk et godt stykke etter leggetid, ble den ignorert. Det er samme
// signal som allerede brukes til å finne når Ole la seg, og det krever verken
// at alarmen ble avvist på en bestemt måte eller at Mac-en er våken.
@MainActor
final class BedtimeWatch {
    static let shared = BedtimeWatch()

    private let defaults = UserDefaults.standard
    private let overshootKey = "bedtimeOvershootMinutes"
    private let nightKey = "bedtimeOvershootNight"

    private init() {}

    // Natta regnes fra middag til middag. Legger Ole seg 00:30, hører det til
    // kvelden før — ellers ville et overtramp over midnatt blitt notert på feil
    // døgn og forsvunnet i det dagen skiftet.
    private func nightKey(for date: Date) -> String {
        let calendar = Calendar.current
        let kveld = calendar.component(.hour, from: date) < 12
            ? calendar.date(byAdding: .day, value: -1, to: date) ?? date
            : date
        let parts = calendar.dateComponents([.year, .month, .day], from: kveld)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }

    /// Noterer hvor langt over leggetid telefonen fortsatt er i bruk.
    /// Kalles hver gang appen er aktiv, og beholder det største overtrampet.
    func noteActivity(targetBedtime: String?, now: Date = .now) {
        guard let bed = minutes(from: targetBedtime) else { return }
        let calendar = Calendar.current
        let nå = calendar.component(.hour, from: now) * 60 + calendar.component(.minute, from: now)
        var overtramp = nå - bed
        if overtramp < -720 { overtramp += 1440 }
        if overtramp > 720 { overtramp -= 1440 }
        guard overtramp > 0 else { return }

        let natt = nightKey(for: now)
        if defaults.string(forKey: nightKey) != natt {
            defaults.set(natt, forKey: nightKey)
            defaults.set(0, forKey: overshootKey)
        }
        // Det største overtrampet gjelder. Ble telefonen brukt til 02:00, er det
        // klokka to som teller, ikke at den også ble sjekket 00:05.
        if overtramp > defaults.integer(forKey: overshootKey) {
            defaults.set(overtramp, forKey: overshootKey)
        }
    }

    /// Hvor mange minutter morgenen skal skyves, etter reglene Mac-en sendte.
    func pushMinutes(targetBedtime: String?, rule: [String: Any]?, now: Date = .now) -> Int {
        guard targetBedtime != nil, defaults.string(forKey: nightKey) == nightKey(for: now) else { return 0 }
        let overtramp = defaults.integer(forKey: overshootKey)
        let grace = rule?["grace"] as? Int ?? 30
        let factor = rule?["factor"] as? Double ?? 0.5
        let max = rule?["max"] as? Int ?? 45
        guard overtramp > grace else { return 0 }
        return Swift.min(max, Int((Double(overtramp - grace) * factor).rounded()))
    }

    /// Ble leggetiden ignorert i natt? Følger med natta til panelet.
    func ignoredBedtime(rule: [String: Any]?, now: Date = .now) -> Bool {
        guard defaults.string(forKey: nightKey) == nightKey(for: now) else { return false }
        return defaults.integer(forKey: overshootKey) > (rule?["grace"] as? Int ?? 30)
    }

    private func minutes(from clock: String?) -> Int? {
        guard let parts = clock?.split(separator: ":").compactMap({ Int($0) }), parts.count == 2 else { return nil }
        return parts[0] * 60 + parts[1]
    }
}
