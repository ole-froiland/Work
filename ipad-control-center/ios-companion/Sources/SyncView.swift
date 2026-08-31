import SwiftUI

struct SyncView: View {
    @ObservedObject var model: MetricsSyncModel
    // En alarm som stille lot være å bli satt er det verste utfallet her, så
    // tillatelsen har sin egen rad i stedet for å bli bedt om i bakgrunnen.
    @State private var alarmStatus = "Sjekker …"
    @State private var alarmCount = 0

    var body: some View {
        NavigationStack {
            Form {
                Section("Datakilder") {
                    sourceRow("Sosiale medier", status: model.screenTimeStatus, icon: "hourglass")
                    sourceRow("Skritt", status: model.stepsStatus, icon: "figure.walk")
                    sourceRow("Posisjon", status: model.locationStatus, icon: "location.fill")
                    // Uten denne raden fantes det ingen måte å se forskjell på
                    // «appen synker i bakgrunnen» og «appen har ikke hatt lov til
                    // det siden sist den ble åpnet». De to ser like ut på panelet.
                    sourceRow("Bakgrunnslevering", status: model.backgroundDeliveryStatus, icon: "arrow.clockwise")
                }

                Section("Alarmer") {
                    HStack {
                        Image(systemName: "alarm.fill").foregroundStyle(.orange).frame(width: 24)
                        Text("Leggetid og oppvåkning")
                        Spacer()
                        Text(alarmStatus).foregroundStyle(.secondary)
                    }
                    // Knappen het «Gi alarmtilgang» også etter at tilgangen var
                    // gitt, og så ut som at ingenting hadde skjedd. Nå sier den
                    // hva den faktisk gjør i den tilstanden appen er i.
                    Button(SleepAlarms.shared.isAuthorized ? "Sett alarmene på nytt" : "Gi alarmtilgang") {
                        Task {
                            let granted = await SleepAlarms.shared.authorize()
                            if granted { await SleepAlarms.shared.refresh() }
                            oppdaterAlarmstatus()
                        }
                    }
                }
                .task { oppdaterAlarmstatus() }

                // To adresser fordi telefonen er ute det meste av døgnet.
                // .local-navnet svarer bare på hjemmenettet, og med det som
                // eneste vei sto panelet stille fra Ole gikk ut om morgenen til
                // han kom hjem igjen — uten at noe sa fra om hvorfor.
                Section {
                    TextField("Adresse", text: $model.endpoint)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                        .autocorrectionDisabled()
                } header: {
                    Text("Hjemmenett")
                } footer: {
                    Text("Bonjour-navnet til Mac-en. Svarer bare når telefonen er på samme wifi.")
                }

                Section {
                    TextField("Adresse", text: $model.fallbackEndpoint)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                        .autocorrectionDisabled()
                } header: {
                    Text("Utenfor hjemmet")
                } footer: {
                    Text("Tailnett-navnet, som svarer likt på skolen, på hotspot og på mobildata. Krever at Tailscale er installert og innlogget på telefonen.")
                }

                Section {
                    if let lastSync = model.lastSync {
                        LabeledContent("Sist kom fram", value: lastSync.formatted(date: .abbreviated, time: .shortened))
                    } else {
                        LabeledContent("Sist kom fram", value: "Aldri")
                    }
                    // Siste forsøk står ved siden av siste suksess, ikke i stedet
                    // for. «Prøvde 14:03, fikk ikke kontakt» og «kom fram 11:15»
                    // er to forskjellige svar, og slås de sammen blir begge
                    // ubrukelige — det er nettopp forskjellen mellom dem som sier
                    // om det er telefonen eller Mac-en som ikke gjør jobben sin.
                    if let attempt = model.lastAttempt, !attempt.succeeded {
                        LabeledContent("Sist forsøkt", value: attempt.at.formatted(date: .abbreviated, time: .shortened))
                        if let failure = attempt.failure {
                            Text(failure).foregroundStyle(.red).font(.footnote)
                        }
                    }
                    // Hvilken av de to adressene som faktisk kom fram. Uten denne
                    // raden ser «virker» og «virker bare hjemme» helt like ut.
                    if let deliveredTo = model.deliveredTo {
                        LabeledContent("Levert til", value: deliveredTo)
                    }
                    if let error = model.errorMessage {
                        Text(error).foregroundStyle(.orange).font(.footnote)
                    }
                } header: {
                    Text("Status")
                } footer: {
                    Text("«Sist forsøkt» uten «kom fram» betyr at Mac-en ikke svarte — som regel at lokket var lukket.")
                }

                Button {
                    Task { await model.connectAndSync() }
                } label: {
                    HStack {
                        Spacer()
                        if model.isSyncing { ProgressView().padding(.trailing, 6) }
                        Text(model.isSyncing ? "Henter sikre data …" : "Koble til og synkroniser")
                            .fontWeight(.semibold)
                        Spacer()
                    }
                }
                .disabled(model.isSyncing)
            }
            .navigationTitle("Panelkobling")
        }
    }

    private func oppdaterAlarmstatus() {
        alarmCount = SleepAlarms.shared.scheduledCount
        if !SleepAlarms.shared.isAuthorized {
            alarmStatus = "Ikke godkjent"
        } else {
            alarmStatus = alarmCount > 0 ? "\(alarmCount) satt" : "Ingen satt"
        }
    }

    private func sourceRow(_ title: String, status: String, icon: String) -> some View {
        LabeledContent {
            Text(status).foregroundStyle(status == "Klar" || status.hasPrefix("På") ? .green : .secondary)
        } label: {
            Label(title, systemImage: icon)
        }
    }
}
