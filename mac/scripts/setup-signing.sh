#!/bin/zsh
# Legt einmalig ein selbstsigniertes Codesigning-Zertifikat in einer eigenen Build-Keychain an
# (Vault: macOS Berechtigungen und Codesigning). Kein Passwort von Hand nötig, Login-Keychain bleibt unberührt.
set -euo pipefail

DIR="$HOME/Library/Application Support/Orbit/Signing"
KEYCHAIN="$DIR/orbit-build.keychain-db"
CN="Orbit Local Code Signing"
mkdir -p "$DIR" && chmod 700 "$DIR"

if [[ -f "$DIR/identity.sha1" && -f "$KEYCHAIN" ]]; then
  echo "Zertifikat vorhanden: $(cat "$DIR/identity.sha1")"
  exit 0
fi

# Das Passwort existiert nur, damit set-key-partition-list nicht interaktiv nachfragt.
PW=$(/usr/bin/openssl rand -hex 16)
umask 077
print -rn -- "$PW" > "$DIR/keychain.pw"

cat > "$DIR/cs.cnf" <<CNF
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = $CN
[ext]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
CNF

# /usr/bin/openssl (LibreSSL) erzeugt ein p12, das `security import` versteht.
/usr/bin/openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
  -keyout "$DIR/key.pem" -out "$DIR/cert.pem" -config "$DIR/cs.cnf"
/usr/bin/openssl pkcs12 -export -out "$DIR/cert.p12" -inkey "$DIR/key.pem" -in "$DIR/cert.pem" -passout "pass:$PW"

security create-keychain -p "$PW" "$KEYCHAIN"
security set-keychain-settings "$KEYCHAIN"
security unlock-keychain -p "$PW" "$KEYCHAIN"
security import "$DIR/cert.p12" -k "$KEYCHAIN" -P "$PW" -A -T /usr/bin/codesign
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$PW" "$KEYCHAIN" > /dev/null

HASH=$(security find-certificate -c "$CN" -Z "$KEYCHAIN" | awk '/SHA-1 hash:/ {print $3; exit}')
[[ -n "$HASH" ]] || { echo "Zertifikat nicht gefunden" >&2; exit 1; }
print -rn -- "$HASH" > "$DIR/identity.sha1"
# Rohschlüssel und p12 werden nicht mehr gebraucht.
rm -f "$DIR/key.pem" "$DIR/cert.p12"
echo "Zertifikat angelegt: $HASH"
