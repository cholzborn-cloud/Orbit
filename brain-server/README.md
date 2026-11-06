# Lokaler Brain-Server

Node.js 24 oder neuer startet den MCP-Server direkt aus TypeScript, ohne Build-Schritt:

```sh
cd brain-server && npm install
BRAIN_SERVER_TOKEN='mindestens-24-zeichen-und-eigener-rotierbarer-token' node src/server.ts
```

Er lauscht ausschließlich auf `127.0.0.1:8420`. Optional sind `BRAIN_SERVER_PORT` und `BRAIN_VAULT_PATH`. Ein eigener, rotierbarer Token mit mindestens 24 Zeichen ist Pflicht. Für die Trigger-Cloud wird `BRAIN_SERVER_TOKEN` per `syncEnvVars` in die Trigger-Umgebung kopiert. Die Orbit-Cloud erreicht den Server nur über einen selbst eingerichteten, zugriffsgeschützten Tunnel. Bei Tailscale Funnel oder Cloudflare Tunnel den Tunnel-Zielport auf `127.0.0.1:8420` setzen und den Zugriff zusätzlich auf vertrauenswürdige Identitäten begrenzen. In Orbit/Trigger/Railway `BRAIN_SERVER_URL` auf die HTTPS-Adresse des Tunnels setzen und `BRAIN_SERVER_TOKEN` als Secret hinterlegen. Tunnel nicht offen ins Internet stellen.

Für launchd die Vorlage `com.consti.orbit-brain.plist.example` kopieren, Platzhalter für Benutzer, Projektpfad, Vault-Pfad und Logdateien anpassen und `BRAIN_SERVER_TOKEN` lokal als Secret ergänzen. Token nicht in diese Vorlage oder ins Repo schreiben. `KeepAlive` startet den Prozess nach einem Absturz erneut. Die Vorlage wird nicht automatisch geladen oder eingerichtet.

Sicherheit: Der MCP-Endpunkt verlangt ausschließlich `Authorization: Bearer`. Lesen, Suchen und Schreiben gelten für Markdown im ganzen Vault; Pfade außerhalb (`..`, Symlinks) werden abgelehnt. `brain_move` verschiebt; ohne Ziel landet die Notiz in `06 Archiv` (nie endgültig löschen). Vault-Zugriff nur über einen vertrauenswürdigen Tunnel freigeben.

Für launchd die Plist nach dem Bearbeiten mit `chmod 600 <Plist-Pfad>` schützen.

Die Memory-Sperre serialisiert parallele Updates nur innerhalb eines einzelnen Trigger-Worker-Prozesses; mehrere Worker-Prozesse teilen diese Sperre nicht.
