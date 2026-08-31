import Foundation

// Hvilke adresser appen i det hele tatt snakker med, og i hvilken rekkefølge den
// prøver dem.
//
// Sjekken lå før i to filer med hver sin kopi av samme betingelse, og begge sa
// bare `.local` eller privat IPv4. Hjemme svarer Bonjour-navnet, men bare der —
// og Ole er ute det meste av døgnet. Panelet ble derfor stående med gårsdagens
// tall uten at noe var i veien med hverken telefonen eller Mac-en: telefonen
// hadde rett og slett ingen adresse den fikk lov til å bruke.
//
// Tailnettet er den ene adressen som svarer likt hjemme, på hotspot og på
// mobildata, og Mac-en ligger der allerede. Derfor to adresser og ikke én. Den
// som svarte sist prøves først, så hjemmenettet, så tailnettet — en telefon på
// hjemme-wifi skal ikke gå veien om internett for å nå maskinen i naborommet.
enum PanelEndpoint {
    static let primaryKey = "panelEndpoint"
    static let fallbackKey = "panelFallbackEndpoint"
    private static let lastGoodKey = "panelLastGoodEndpoint"

    static let defaultPrimary = "http://Ole-sin-MacBook-Air.local:4173/api/device-metrics"
    // MagicDNS-navnet krever at telefonen selv er logget inn i tailnettet. Er
    // den ikke det, feiler forsøket her og feilteksten sier hvorfor, i stedet
    // for at panelet bare blir stående tomt.
    static let defaultFallback = "http://ole-mac-panel.tail161d1e.ts.net:4173/api/device-metrics"

    static var primary: String {
        get { UserDefaults.standard.string(forKey: primaryKey) ?? defaultPrimary }
        set { UserDefaults.standard.set(newValue, forKey: primaryKey) }
    }

    static var fallback: String {
        get { UserDefaults.standard.string(forKey: fallbackKey) ?? defaultFallback }
        set { UserDefaults.standard.set(newValue, forKey: fallbackKey) }
    }

    // Hvilken av de to som faktisk kom fram sist. Den står i appen, slik at
    // «det virker» og «det virker bare når jeg er hjemme» kan skilles fra
    // hverandre uten å gjette.
    private(set) static var lastGood: String? {
        get { UserDefaults.standard.string(forKey: lastGoodKey) }
        set { UserDefaults.standard.set(newValue, forKey: lastGoodKey) }
    }

    static var lastGoodHost: String? {
        lastGood.flatMap { URL(string: $0)?.host }
    }

    // Guarden finnes fordi appen ligger på en telefon som er innom fremmede
    // nett hele dagen, og skrittene, skjermtiden og posisjonen skal bare til
    // Mac-en. Alle de godkjente formene har det til felles at de ikke kan nå
    // lenger enn hjemmenettet eller Oles eget tailnett.
    static func isPanelHost(_ host: String?) -> Bool {
        guard let host = host?.lowercased(), !host.isEmpty else { return false }
        if host == "localhost" { return true }
        // Bonjour hjemme, MagicDNS overalt ellers.
        if host.hasSuffix(".local") || host.hasSuffix(".ts.net") { return true }
        return isPrivateAddress(host)
    }

    // Tidligere sto dette som en rad `hasPrefix`-er, og «172.2» blant dem —
    // som slapp gjennom hele 172.2.0.0/16, et helt vanlig offentlig nett.
    // Oktetter sammenlignes som tall nå, så området er det RFC-en sier.
    private static func isPrivateAddress(_ host: String) -> Bool {
        let octets = host.split(separator: ".", omittingEmptySubsequences: false)
            .compactMap { UInt8($0) }
        guard octets.count == 4 else { return false }
        switch (octets[0], octets[1]) {
        case (10, _), (127, _): return true
        case (192, 168): return true
        case (172, 16...31): return true
        // Tailscale deler ut adresser fra CGNAT-blokka 100.64.0.0/10.
        case (100, 64...127): return true
        default: return false
        }
    }

    // Adressene lagres som hele URL-er til `/api/device-metrics`, slik de alltid
    // har blitt. De andre endepunktene ligger ved siden av og utledes herfra, så
    // Ole bare har én adresse å skrive inn per vei.
    static func url(_ endpoint: String, path: String) -> URL? {
        let trimmed = endpoint.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty,
              let url = URL(string: trimmed),
              isPanelHost(url.host) else { return nil }
        return url.deletingLastPathComponent().appendingPathComponent(path)
    }

    static func candidates(path: String) -> [(endpoint: String, url: URL)] {
        var seen = Set<String>()
        return [lastGood, primary, fallback]
            .compactMap { $0 }
            .filter { seen.insert($0).inserted }
            .compactMap { endpoint in url(endpoint, path: path).map { (endpoint, $0) } }
    }

    // Sender til den første adressen som svarer, og husker hvilken det var.
    @discardableResult
    static func send(
        path: String,
        method: String = "GET",
        body: Data? = nil,
        timeout: TimeInterval = 8
    ) async throws -> Data {
        let targets = candidates(path: path)
        guard !targets.isEmpty else { throw PanelEndpointError.notConfigured }

        var lastFailure: Error?
        for target in targets {
            var request = URLRequest(url: target.url)
            request.httpMethod = method
            request.httpBody = body
            if body != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
            // Uten dette gjaldt standardfristen på seksti sekunder. HealthKit
            // vekker appen med et kort budsjett og venter på at completion-blokka
            // kalles; blir den stående og vente på en Mac som sover, rekker ikke
            // synken å melde fra før budsjettet er brukt opp — og iOS slutter
            // til slutt å vekke appen i det hele tatt.
            request.timeoutInterval = timeout

            do {
                let (data, response) = try await URLSession.shared.data(for: request)
                guard let http = response as? HTTPURLResponse else {
                    lastFailure = PanelEndpointError.rejected
                    continue
                }
                guard (200..<300).contains(http.statusCode) else {
                    // Verten svarte, men sa nei. Da er ikke en annen adresse
                    // svaret — panelet er nådd, og feilen ligger i det som ble
                    // sendt. Å prøve videre ville skjult den.
                    lastGood = target.endpoint
                    throw PanelEndpointError.rejected
                }
                lastGood = target.endpoint
                return data
            } catch let error as PanelEndpointError {
                throw error
            } catch {
                lastFailure = error
            }
        }
        // Ingen av dem svarte. Da skal heller ikke den ene av dem bli stående
        // som førstevalg neste gang.
        lastGood = nil
        throw PanelEndpointError.unreachable(lastFailure?.localizedDescription ?? "Ingen av adressene svarte.")
    }
}

enum PanelEndpointError: LocalizedError {
    case notConfigured
    case rejected
    case unreachable(String)

    var errorDescription: String? {
        switch self {
        case .notConfigured:
            "Adressen må peke på Mac-en: et .local-navn, en privat nettverksadresse eller tailnettet."
        case .rejected:
            "Dashboardet tok imot, men avviste innholdet."
        case .unreachable(let reason):
            // Nesten alltid «Mac-en sov» eller «telefonen er utenfor både
            // hjemmenettet og tailnettet». Grunnen fra systemet står som den er,
            // for det er den som skiller de to fra hverandre.
            "Fikk ikke kontakt med panelet: \(reason)"
        }
    }
}
