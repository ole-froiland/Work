import Foundation

// Panelet måler bare det Ole vil bruke mindre tid på. Filteret står her, i
// telefonen, slik at bruken av alt annet aldri forlater enheten — Mac-en får
// verken totalen eller navnet på appene utenfor lista.
//
// Den samme lista finnes i src/dashboard.js, som filtrerer en gang til i
// tilfelle et eldre oppsett ligger i mellomlageret. Endrer du én, endre begge.
enum SocialApps {
    private static let bundleIdentifiers: Set<String> = [
        "com.burbn.instagram",
        "com.toyopagroup.picaboo",
        "com.zhiliaoapp.musically",
        "com.facebook.facebook",
        "com.facebook.messenger",
        "com.atebits.tweetie2",
        "com.burbn.barcelona",
        "com.reddit.reddit",
        "com.linkedin.linkedin",
        "pinterest",
        "com.tumblr.tumblr",
        "alexisbarreyat.bereal",
        "com.hammerandchisel.discord",
        "tv.twitch",
        "com.google.ios.youtube",
    ]

    // DeviceActivity oppgir ikke alltid bunt-ID-en. Da er visningsnavnet det
    // eneste vi har å kjenne appen igjen på.
    private static let displayNames: Set<String> = [
        "instagram", "snapchat", "tiktok", "facebook", "messenger", "x",
        "twitter", "threads", "reddit", "linkedin", "pinterest", "tumblr",
        "bereal", "discord", "twitch", "youtube",
    ]

    static func isSocial(bundleIdentifier: String?, displayName: String?) -> Bool {
        if let identifier = bundleIdentifier?.lowercased(), bundleIdentifiers.contains(identifier) {
            return true
        }
        let name = displayName?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased() ?? ""
        return displayNames.contains(name)
    }
}
