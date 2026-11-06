import SwiftUI

// Routine-Vorschlag (Figma 139:40558): kompakte Karte 360, Name und Zeit, darunter „Erstellen“ und „Bearbeiten“; nach dem Anlegen „Routine erstellt“.
struct RoutineCardView: View {
    let name: String
    let schedule: String
    // Figur-Angaben bleiben für Aufrufer erhalten, die Karte zeigt sie nicht mehr (Figma: Symbol history).
    var botName = "Orbi"
    var avatar: String?
    var colorHex: String?
    // Figma „Zustand=Gruppe“: Erstellen neutral; „Zustand=erstellt“: Statuszeile statt Knöpfen.
    var neutral = false
    var created = false
    var onEdit: () -> Void = {}
    var onCreate: () -> Void = {}

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            HStack(alignment: .top, spacing: Theme.Metrics.pt10) {
                Image(systemName: "clock.arrow.circlepath").font(.system(size: Theme.Metrics.pt14)).foregroundStyle(Theme.Palette.mutedForeground)
                    .padding(.top, Theme.Metrics.pt3)
                VStack(alignment: .leading, spacing: Theme.Metrics.pt2) {
                    Text(name).font(Theme.Fonts.bodyMedium).lineHeight(.exact(points: Theme.Fonts.bodyLine)).foregroundStyle(Theme.Palette.foreground)
                    Text(schedule).font(Theme.Fonts.subhead).lineHeight(.exact(points: Theme.Metrics.pt18)).foregroundStyle(Theme.Palette.mutedForeground)
                }
                Spacer(minLength: Theme.Metrics.pt0)
            }
            if created {
                HStack(spacing: Theme.Metrics.pt6) {
                    Image(systemName: "checkmark").font(.system(size: Theme.Metrics.pt14))
                    Text("Routine erstellt").font(Theme.Fonts.subhead).lineHeight(.exact(points: Theme.Metrics.pt18))
                }
                .foregroundStyle(Theme.Palette.mutedForeground)
                .accessibilityElement(children: .combine)
            } else {
                HStack(spacing: Theme.Spacing.sm) {
                    Button("Erstellen", action: onCreate).buttonStyle(.pill(.solid, neutral: neutral))
                    Button("Bearbeiten", action: onEdit).buttonStyle(.pill(.bordered))
                    Spacer(minLength: Theme.Metrics.pt0)
                }
            }
        }
        .padding(Theme.Metrics.pt14)
        .cardSurface(radius: Theme.Metrics.pt12, line: Theme.Metrics.pt0_5)
        .webCardWidth(max: Theme.Metrics.pt360)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Routine vorschlagen: \(name)")
    }
}
