<Frame name="Mail · Passwort zurücksetzen" w={640} bg="#EDEDF2" flex="col" items="center" py={56} px={40} gap={20}>
  <Frame name="Karte" w={560} bg="#FFFFFF" rounded={36} flex="col" items="center" stroke="#E2E2E8" strokeWidth={1} overflow="hidden" shadow="0 24px 48px rgba(28,28,28,0.08)">
    <Frame name="Bühne" w={560} h={200} bg="#111114" flex="col" items="center" justify="center" gap={14}>
      <Frame name="Ring" w={56} h={56} rounded={28} stroke="#FFFFFF" strokeWidth={4} />
      <Text size={22} weight="bold" color="#FFFFFF" letterSpacing={-0.4}>Orbit</Text>
    </Frame>
    <Frame name="Inhalt" w={560} flex="col" items="center" gap={12} pt={40} pb={8} px={48}>
      <Text size={28} weight="semibold" color="#111114" lineHeight={34} align="center" w="fill">Neues Passwort wählen</Text>
      <Text size={16} color="#6B6B76" lineHeight={24} align="center" w="fill">Tippe auf den Knopf und wähle ein neues Passwort für dein Orbit-Konto.</Text>
      <Text size={13} weight="medium" color="#A0A0AA" align="center" w="fill">name@beispiel.de</Text>
    </Frame>
    <Frame name="Knopf-Zeile" w={560} flex="col" items="center" py={28}>
      <Frame name="Knopf" bg="#111114" rounded={999} flex="row" items="center" justify="center" px={36} h={52}>
        <Text size={16} weight="medium" color="#FFFFFF">Passwort zurücksetzen</Text>
      </Frame>
    </Frame>
    <Frame name="Fuß" w={560} flex="col" items="center" pt={4} pb={40} px={48} gap={8}>
      <Text size={13} color="#9A9AA4" lineHeight={19} align="center" w="fill">Du hast das nicht angefragt? Dann ignoriere diese Mail. Dein Passwort bleibt, wie es ist.</Text>
    </Frame>
  </Frame>
  <Text size={12} color="#9A9AA4" align="center" w="fill" lineHeight={18}>Orbit · Dein Team ist schon da.</Text>
</Frame>
