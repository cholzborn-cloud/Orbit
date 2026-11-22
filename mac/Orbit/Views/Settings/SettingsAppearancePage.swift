import SwiftUI

// Bereich „Darstellung“: Erscheinungsbild (Hell, Dunkel, System) und App-Symbol.
struct SettingsAppearancePage: View {
    let store: SettingsStore

    private static let options: [(value: String, label: String)] = [("light", "Hell"), ("dark", "Dunkel"), ("system", "System")]

    var body: some View {
        FormPage(title: "Darstellung") {
            FormSection {
                FormRow(title: "Erscheinungsbild") {
                    WebSegment(items: Self.options.map(\.value),
                               selection: Binding(get: { store.theme }, set: { value in Task { await store.setTheme(value) } }),
                               title: { value in Self.options.first { $0.value == value }?.label ?? value })
                        .frame(width: Theme.Metrics.pt240)
                        .accessibilityLabel("Erscheinungsbild")
                }
            }
            if let error = store.themeError { SettingsAlert(text: error) }
            SettingsAppIconView()
        }
    }
}
