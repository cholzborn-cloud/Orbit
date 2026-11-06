import SwiftUI

// Reiter „Nutzung“ (usage-section.tsx, usage-card.tsx): Karte je Anbieter, Balken je Fenster, Hinweis darunter.
struct SettingsUsageView: View {
    let store: SettingsStore

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Metrics.pt16) {
            HStack(spacing: Theme.Metrics.pt8) {
                VStack(alignment: .leading, spacing: Theme.Metrics.pt0) {
                    Text("Nutzung").font(Theme.Fonts.settingsTitle).accessibilityAddTraits(.isHeader)
                    if let usage = store.usage.value {
                        Text("Stand \(Self.time(usage.fetchedAt))").font(Theme.Fonts.small).lineHeight(.exact(points: Theme.Metrics.pt16)).foregroundStyle(Theme.Palette.mutedForeground)
                    }
                }
                Spacer()
                // Figma 143:54363: Pille 24, nur Text.
                Button("Aktualisieren") { Task { await store.loadUsage(fresh: true) } }
                    .buttonStyle(.card(.outline)).disabled(store.usage.isLoading)
            }
            switch store.usage {
            case .idle, .loading:
                // Figma 143:54520: 2 Boxen, Platzhalter 120 × 14 (r6), Balken 6 (r3), 200 × 12 (r6), Balken 6; innen 12, Abstand 10.
                VStack(spacing: Theme.Metrics.pt16) {
                    ForEach(0..<2, id: \.self) { _ in
                        VStack(alignment: .leading, spacing: Theme.Metrics.pt10) {
                            SettingsSkeleton(height: Theme.Metrics.pt14, radius: Theme.Radius.sm).frame(width: Theme.Metrics.pt120)
                            SettingsSkeleton(height: Theme.Metrics.pt6, radius: Theme.Metrics.pt3)
                            SettingsSkeleton(height: Theme.Metrics.pt12, radius: Theme.Radius.sm).frame(width: Theme.Metrics.pt200)
                            SettingsSkeleton(height: Theme.Metrics.pt6, radius: Theme.Metrics.pt3)
                        }
                        .padding(Theme.Metrics.pt12).frame(maxWidth: .infinity, alignment: .leading)
                        .background(Theme.Palette.card, in: .rect(cornerRadius: Theme.Radius.lg))
                        .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).strokeBorder(Theme.Palette.border, lineWidth: Theme.Metrics.pt0_5))
                    }
                }
                    .accessibilityElement(children: .ignore).accessibilityLabel("Lädt")
            case .failed(let message, let offline):
                UsageFailure(message: message, offline: offline) { Task { await store.loadUsage() } }
            case .loaded(let usage):
                if usage.providers.isEmpty {
                    SettingsHint(text: "Der Dienst hat keine Nutzungsdaten geliefert.")
                } else {
                    // Figma Nutzung (143:54364/54386): Abstand 16 zwischen den Boxen.
                    VStack(spacing: Theme.Metrics.pt16) { ForEach(usage.providers) { UsageCard(provider: $0, now: Date(timeIntervalSince1970: usage.fetchedAt / 1000)) } }
                }
            }
        }
    }

    static func time(_ ms: Double) -> String {
        let f = DateFormatter(); f.locale = Locale(identifier: "de_DE"); f.dateFormat = "HH:mm"
        return f.string(from: Date(timeIntervalSince1970: ms / 1000))
    }
}

// Hinweis-Box (Figma 143:54542 / 54556): Zeile (Symbol 16, Titel 14 Medium, Meldung 14 muted) und darunter eine Knopfzeile mit Linie.
// Offline: Titel neutral; Fehler: Titel rot.
private struct UsageFailure: View {
    let message: String
    let offline: Bool
    let retry: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Metrics.pt0) {
            HStack(alignment: .top, spacing: Theme.Metrics.pt10) {
                Image(systemName: offline ? "wifi.slash" : "exclamationmark.circle").font(.system(size: Theme.Metrics.pt13))
                    .foregroundStyle(offline ? Theme.Palette.mutedForeground : Theme.Palette.destructive)
                    .frame(width: Theme.Metrics.pt16, height: Theme.Metrics.pt16).padding(.top, Theme.Metrics.pt2)
                VStack(alignment: .leading, spacing: Theme.Metrics.pt2) {
                    Text(offline ? "Dienst nicht erreichbar" : "Konnte nicht geladen werden").font(Theme.Fonts.bodyMedium).lineHeight(.exact(points: Theme.Metrics.pt20))
                        .foregroundStyle(offline ? Theme.Palette.foreground : Theme.Palette.destructive)
                    Text(message).font(Theme.Fonts.body).lineHeight(.exact(points: Theme.Metrics.pt20)).foregroundStyle(Theme.Palette.mutedForeground).fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: Theme.Metrics.pt0)
            }
            .padding(Theme.Metrics.pt12)
            HStack { Button("Erneut laden", action: retry).buttonStyle(.card(.outline)); Spacer(minLength: Theme.Metrics.pt0) }
                .padding(.horizontal, Theme.Metrics.pt12).padding(.vertical, Theme.Metrics.pt10)
                .overlay(alignment: .top) { Rectangle().fill(Theme.Palette.border).frame(height: Theme.Metrics.pt0_5) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.Palette.card, in: .rect(cornerRadius: Theme.Radius.lg))
        .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).strokeBorder(Theme.Palette.border, lineWidth: Theme.Metrics.pt0_5))
    }
}

private struct UsageCard: View {
    let provider: UsageProvider
    let now: Date
    @State private var selected: String?

    // Figma 143:54376/54384: „Setzt um 23:40 zurück.“ bzw. „Setzt am Mo., 2. Nov., 09:00 zurück.“ (K56).
    static func resetText(_ window: UsageWindow, now: Date) -> String {
        guard window.resetDate > now else { return "Rücksetzung steht an." }
        let soon = window.resetDate.timeIntervalSince(now) < 86400
        let f = DateFormatter(); f.locale = Locale(identifier: "de_DE")
        f.dateFormat = soon ? "HH:mm" : "EEE, d. MMM, HH:mm"
        return "\(window.used >= 1 ? "Aufgebraucht. " : "")Setzt \(soon ? "um" : "am") \(f.string(from: window.resetDate)) zurück."
    }

    private var account: UsageAccount? { provider.accounts.first { $0.id == selected } ?? provider.accounts.first }
    private var status: String { account?.status ?? provider.status }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Metrics.pt0) {
            HStack(spacing: Theme.Metrics.pt8) {
                ProviderIcon(provider: provider.iconProvider, size: Theme.Metrics.pt12)
                    .frame(width: Theme.Metrics.pt20, height: Theme.Metrics.pt20)
                    .background(Theme.Palette.secondary, in: .rect(cornerRadius: Theme.Metrics.pt6))
                Text(provider.name).font(Theme.Fonts.bodyMedium)
                if status == "limit" { SettingsBadge(text: "Pausiert, wartet", tone: .secondary) }
                Spacer(minLength: Theme.Metrics.pt0)
                if provider.accounts.count > 1 {
                    WebSelect(options: provider.accounts.map { ($0.id, $0.label) }, selection: Binding(get: { account?.id ?? "" }, set: { selected = $0 }),
                              small: true, label: "Konto für \(provider.name)")
                        .frame(maxWidth: Theme.Metrics.pt160)
                }
            }
            .padding(.horizontal, Theme.Metrics.pt12)
            .frame(height: Theme.Metrics.pt40)
            if let account, status == "ok" || status == "limit" {
                ForEach(account.windows, id: \.name) { window in
                    // Figma Zeile (143:54369): Linie oben 0,5, innen 10/12/12/12, Abstand 6; Beschriftung 14 Regular, Prozent 14 Medium
                    // (ab 80 % rot), Spur track.
                    VStack(alignment: .leading, spacing: Theme.Metrics.pt6) {
                        HStack {
                            Text(window.label).font(Theme.Fonts.body).lineHeight(.exact(points: Theme.Metrics.pt20))
                            Spacer()
                            Text("\(window.percent) %").font(Theme.Fonts.bodyMedium).lineHeight(.exact(points: Theme.Metrics.pt20))
                                .foregroundStyle(window.percent >= 80 ? Theme.Palette.destructive : Theme.Palette.cardForeground)
                        }.frame(height: Theme.Metrics.pt20)
                        Capsule().fill(Theme.Palette.track).frame(height: Theme.Metrics.pt6)
                            .overlay(alignment: .leading) {
                                GeometryReader { geometry in
                                    Capsule().fill(window.percent >= 80 ? Theme.Palette.destructive : Theme.Palette.foreground)
                                        .frame(width: geometry.size.width * CGFloat(window.percent) / 100)
                                }
                            }
                        Text(Self.resetText(window, now: now)).font(Theme.Fonts.small).foregroundStyle(window.used >= 1 ? Theme.Palette.destructive : Theme.Palette.mutedForeground)
                        if window.name == "7d" && window.percent >= 80 && window.used < 1 {
                            Text(UsageText.forecast(window, now: now)).font(Theme.Fonts.small).foregroundStyle(Theme.Palette.mutedForeground)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    .padding(.horizontal, Theme.Metrics.pt12).padding(.top, Theme.Metrics.pt10).padding(.bottom, Theme.Metrics.pt12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .overlay(alignment: .top) { Rectangle().fill(Theme.Palette.border).frame(height: Theme.Metrics.pt0_5) }
                    .accessibilityElement(children: .combine)
                }
            }
            if let message { message.padding(Theme.Metrics.pt12) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.Palette.card, in: .rect(cornerRadius: Theme.Radius.lg))
        .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).strokeBorder(Theme.Palette.border, lineWidth: Theme.Metrics.pt0_5))
    }

    // Hinweis unter den Balken: Status, Notiz oder „Kein Konto“. Fehlende Daten heißen „unbekannt“, nie „frei“.
    private var message: Message? {
        let note = account?.note ?? provider.note
        let text: String?
        var tone: Tone = .muted
        if status == "offline" { text = "Die Nutzungsanzeige ist nicht erreichbar. Nutzung: unbekannt." }
        else if status == "error" { text = (note ?? "Abfrage fehlgeschlagen.") + " Nutzung: unbekannt."; tone = .error }
        else if status == "limit" { text = note ?? "Pausiert, wartet."; tone = .error }
        else if account == nil { text = "Kein Konto verbunden. Nutzung: unbekannt." }
        else if account?.windows.isEmpty == true { text = (note ?? "Keine Daten.") + " Nutzung: unbekannt." }
        else { text = note }
        guard let text else { return nil }
        return Message(text: text, tone: tone, offline: status == "offline")
    }

    enum Tone { case muted, error }
    struct Message: View {
        let text: String
        let tone: Tone
        var offline = false
        var body: some View {
            HStack(alignment: .top, spacing: Theme.Metrics.pt8) {
                if offline { Image(systemName: "wifi.slash").font(.system(size: Theme.Metrics.pt13)).frame(width: Theme.Metrics.pt16, height: Theme.Metrics.pt16).padding(.top, Theme.Metrics.pt2) }
                if tone == .error { Image(systemName: "exclamationmark.triangle").font(.system(size: Theme.Metrics.pt13)).frame(width: Theme.Metrics.pt16, height: Theme.Metrics.pt16).padding(.top, Theme.Metrics.pt2) }
                Text(text).font(Theme.Fonts.body).lineHeight(.exact(points: Theme.Metrics.pt20)).fixedSize(horizontal: false, vertical: true)
            }
            .foregroundStyle(tone == .error ? Theme.Palette.destructive : Theme.Palette.mutedForeground)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}
