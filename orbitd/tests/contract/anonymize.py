"""Macht die Aufnahmen in golden/ unkenntlich (an Ort und Stelle, wiederholbar).

Aufruf: anonymize.py [ORDNER]   (Standard: golden/ neben dieser Datei)
Bleibt: Struktur, Schlüssel, Zahlen, Wahrheitswerte, IDs, Aufzählungswerte (kurze Wörter ohne Leerzeichen) und die öffentlichen Kataloge.
Ersetzt: freie Texte und Namen durch Platzhalter nach Längenklasse („<text-kurz|mittel|lang>“), E-Mail-Adressen,
Pfade mit Nutzernamen, URLs (ohne Parameter), Token-artige Zeichenketten. record.py ruft `clean()` vor dem Speichern.
"""
import json
import re
import sys
from pathlib import Path

EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+")
HOME = re.compile(r"(/Users|/home)/[^/\s\"'<>]+")
URL = re.compile(r"(https?://[^\s\"'<>?#]+)[?#][^\s\"'<>]*")
PERSON = re.compile(r"Constantin|Holzborn|Consti\b")  # Name des Nutzers (großgeschrieben; „consti“ als Absender-Kennung bleibt)
TOKEN = re.compile(r"\b(?:sk-[A-Za-z0-9_-]{10,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[a-z]-[A-Za-z0-9-]{10,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_.-]+|Bearer\s+[A-Za-z0-9._~+/=-]{16,}|[A-Za-z0-9_-]{40,})")
ENUM = re.compile(r"[A-Za-z0-9_.:#/-]{1,64}")
FILENAME = re.compile(r"^[^/]*[A-Za-z0-9]\.[A-Za-z0-9]{2,5}$")  # Dateinamen (Ordnerlisten) verraten Inhalte
PLACEHOLDER = re.compile(r"<text-(kurz|mittel|lang)>")
# Namen von Menschen und Orbis: immer ersetzen, auch wenn sie wie ein Wort aussehen.
NAME_KEYS = {"name", "title", "job", "handle", "displayName", "email", "avatar_url", "calendar", "label", "filename", "fileName", "file"}
# Öffentliche Kataloge (Marktplatz, Modelle): Texte bleiben, nur die Muster oben greifen.
# Feste Dienst-Texte, die Tests mit der Aufnahme vergleichen.
KEEP_KEYS = {"limitations"}
PUBLIC = ("get_v1_plugins", "get_v1_marketplace", "get_v1_models", "get_v1_connectors", "get_v1_skills_slash", "get_v1_usage", "get_v1_status", "get_v1_health")


def placeholder(text: str) -> str:
    return f"<text-{'kurz' if len(text) <= 40 else 'mittel' if len(text) <= 400 else 'lang'}>"


def scrub(text: str) -> str:
    text = EMAIL.sub("nutzer@example.invalid", text)
    text = PERSON.sub("Nutzer", text)
    text = HOME.sub(r"\1/nutzer", text)
    text = URL.sub(r"\1", text)
    return TOKEN.sub(lambda m: m.group(0) if re.fullmatch(r"[0-9a-f]{40,}", m.group(0)) else "<token>", text)  # reine Hex-Zeichenketten sind IDs/Prüfsummen


def clean(value, key: str = "", public: bool = False):
    if isinstance(value, dict):
        return {k: clean(v, k, public) for k, v in value.items()}
    if isinstance(value, list):
        return [clean(v, key, public) for v in value]
    if not isinstance(value, str):
        return value
    text = scrub(value)
    if public or key in KEEP_KEYS or PLACEHOLDER.fullmatch(text) or text in ("", "<token>"):
        return text
    if key in NAME_KEYS or FILENAME.search(text) or not (ENUM.fullmatch(text) and "@" not in text):
        return placeholder(text)
    return text


def main(folder: Path) -> int:
    n = 0
    for f in sorted(folder.glob("*.json")):
        data = json.loads(f.read_text())
        data["body"] = clean(data.get("body"), "", f.name.startswith(PUBLIC))
        f.write_text(json.dumps(data, indent=2, ensure_ascii=False, sort_keys=True) + "\n")
        n += 1
    print(f"{n} Aufnahmen anonymisiert in {folder}")
    return 0


if __name__ == "__main__":
    sys.exit(main(Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parent / "golden"))
