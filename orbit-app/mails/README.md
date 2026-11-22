# Orbit-Konto-Mails

Supabase rendert die Codes. Mailjet Free ist als SMTP-Relay vorgesehen.

| Vorlage in Supabase | Betreff | HTML |
|---|---|---|
| Confirm signup | Orbit: E-Mail bestätigen | `bestaetigen-code.html` |
| Magic Link | Dein Anmeldecode für Orbit | `anmelden-code.html` |
| Reset password | Orbit: Passwort zurücksetzen | `passwort-zuruecksetzen.html` |

Alle drei Vorlagen teilen den sechsstelligen Supabase-Code nach der dritten Ziffer (z. B. `123 456`). Unter **Authentication → Sign In / Providers → Email** bleibt die Bestätigung eingeschaltet. Orbit erwartet einen sechsstelligen Code. Die Passwort-Vorlage erst zusammen mit einer App-Version aktivieren, die den Reset per Code unterstützt.

Die kleinen Orbis liegen in `assets/orbis-kopf.png` und sind in den HTML-Dateien eingebettet. Manche Mailprogramme blenden eingebettete Bilder aus. Für eine breitere Bildanzeige beim Live-Setup die PNG unter einer freigegebenen öffentlichen HTTPS-Adresse bereitstellen und in allen drei `img`-Elementen die Adresse einsetzen. Der Code bleibt normaler Text.

## Mailjet Free verbinden

1. Im [Mailjet-Konto](https://app.mailjet.com/signup) den Free-Tarif wählen. Unter **Account Settings → Senders & Domains** einen Absender hinzufügen und per E-Mail bestätigen. Bei einer Outlook-Adresse kann die Zustellung eingeschränkt sein. Prüfe besonders den Empfang bei Outlook und Gmail.
2. In Mailjet **Account Settings → SMTP and SEND API Settings** öffnen. In [Supabase → Authentication → Emails](https://supabase.com/dashboard/project/wasovzfpbkfzzyfyqxjm/auth/templates) den Reiter **SMTP Settings** öffnen. Den verifizierten Mailjet-Absender mit Absendername **Orbit**, Host `in-v3.mailjet.com`, Port `587` und den Mailjet-SMTP-Benutzernamen eintragen. Das Mailjet-SMTP-Passwort direkt in Supabase eintragen.
3. Unter **Templates** die Betreffe und HTML-Vorlagen aus der Tabelle speichern.
4. Registrierung, Anmeldung und Passwort-Reset mit einem dafür freigegebenen Testkonto prüfen. Für jeden Ablauf Mailjets Zustellstatus und die Eingabe des Codes in Orbit prüfen.
