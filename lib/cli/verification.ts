// Ein erfolgreicher echter Modelllauf belegt die Anmeldung nur für kurze Zeit.
let agyVerifiedAt = 0
export function recordAgyVerification(ok: boolean, now = Date.now()) { agyVerifiedAt = ok ? now : 0 }
export function agyRecentlyVerified(now = Date.now()) { return agyVerifiedAt > 0 && now >= agyVerifiedAt && now - agyVerifiedAt < 5 * 60_000 }
