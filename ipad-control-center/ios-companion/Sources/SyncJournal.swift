import Foundation

// Hva som skjedde sist appen prøvde, og om det gikk.
//
// To feil gjorde at dette ikke gikk an å se før. `lastSync` og `errorMessage`
// lå bare i minnet, og appen kjører nesten aldri fordi noen åpnet den — den blir
// relansert i bakgrunnen av HealthKit, gjør jobben og dør igjen. Alt den lærte
// var borte til neste gang noen så etter.
//
// Og `refreshAll` nullstilte feilmeldingen helt i starten av hver kjøring. Åpnet
// Ole appen for å se *hvorfor* det sto stille, startet det en ny synk som slettet
// beviset — og traff den en Mac som tilfeldigvis var våken akkurat da, sto det
// ingenting igjen å lese. Feilen var usynlig nøyaktig når man lette etter den.
//
// Derfor: forsøket skrives til disk når det er ferdig, ikke når det begynner, og
// forrige utfall blir stående til det finnes et nytt å sette i stedet.
struct SyncAttempt: Codable {
    let at: Date
    let failure: String?
    let host: String?

    var succeeded: Bool { failure == nil }
}

enum SyncJournal {
    private static let attemptKey = "panelLastAttempt"
    private static let successKey = "panelLastSuccess"

    static var lastAttempt: SyncAttempt? {
        get { read(attemptKey) }
        set { write(newValue, to: attemptKey) }
    }

    // Siste gang noe faktisk kom fram. Står ved siden av forsøket, for «prøvde
    // 14:03, feilet» og «kom fram 11:15» er to forskjellige spørsmål, og å slå
    // dem sammen gjør begge ubrukelige.
    static var lastSuccess: SyncAttempt? {
        get { read(successKey) }
        set { write(newValue, to: successKey) }
    }

    static func record(failure: String?, host: String?, at: Date = .now) {
        let attempt = SyncAttempt(at: at, failure: failure, host: host)
        lastAttempt = attempt
        if failure == nil { lastSuccess = attempt }
    }

    private static func read(_ key: String) -> SyncAttempt? {
        guard let data = UserDefaults.standard.data(forKey: key) else { return nil }
        return try? JSONDecoder.panelDecoder.decode(SyncAttempt.self, from: data)
    }

    private static func write(_ value: SyncAttempt?, to key: String) {
        guard let value, let data = try? JSONEncoder.panelDateEncoder.encode(value) else {
            UserDefaults.standard.removeObject(forKey: key)
            return
        }
        UserDefaults.standard.set(data, forKey: key)
    }
}

private extension JSONEncoder {
    static var panelDateEncoder: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }
}

private extension JSONDecoder {
    static var panelDecoder: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}
