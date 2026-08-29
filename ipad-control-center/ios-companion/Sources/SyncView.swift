import SwiftUI

struct SyncView: View {
    @ObservedObject var model: MetricsSyncModel
    // En alarm som stille lot være å bli satt er det verste utfallet her, så
    // tillatelsen har sin egen rad i stedet for å bli bedt om i bakgrunnen.
    @State private var alarmStatus = "Ikke godkjent"

    var body: some View {
        NavigationStack {
            Form {
                Section("Datakilder") {
                    sourceRow("Sosiale medier", status: model.screenTimeStatus, icon: "hourglass")
                    sourceRow("Skritt", status: model.stepsStatus, icon: "figure.walk")
                    sourceRow("Posisjon", status: model.locationStatus, icon: "location.fill")
                }

                Section("Alarmer") {
                    HStack {
                        Image(systemName: "alarm.fill").foregroundStyle(.orange).frame(width: 24)
                        Text("Leggetid og oppvåkning")
                        Spacer()
                        Text(alarmStatus).foregroundStyle(.secondary)
                    }
                    Button("Gi alarmtilgang") {
                        Task {
                            let granted = await SleepAlarms.shared.authorize()
                            alarmStatus = granted ? "Klar" : "Avslått"
                            if granted { await SleepAlarms.shared.refresh() }
                        }
                    }
                }

                Section("Dashboard på Mac") {
                    TextField("Adresse", text: $model.endpoint)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                        .autocorrectionDisabled()
                    if let lastSync = model.lastSync {
                        LabeledContent("Sist synket", value: lastSync.formatted(date: .abbreviated, time: .shortened))
                    }
                    if let error = model.errorMessage {
                        Text(error).foregroundStyle(.red)
                    }
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

    private func sourceRow(_ title: String, status: String, icon: String) -> some View {
        LabeledContent {
            Text(status).foregroundStyle(status == "Klar" ? .green : .secondary)
        } label: {
            Label(title, systemImage: icon)
        }
    }
}
