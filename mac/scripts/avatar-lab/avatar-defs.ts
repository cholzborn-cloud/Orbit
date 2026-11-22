// Die 15 Avatare: 10 Vorlagen des Avatar-Labs (mit angepasstem Augenabstand bei Cloudee und Cubee) plus 5 Grundformen.
import { surfacePresets } from '$LAB/packages/avatar-core/src/surfaces'
import doc from '$LAB/src/features/studio/defaultStudioDocument.json' with { type: 'json' }

const eyeFix: Record<string, Record<string, number>> = { Cloudee: { spacing: 30 }, Cubee: { spacing: 31 } }
const extra = (name: string, body: string, primary: any, eyes: any = {}) => ({ name, colors: { body, eyes: '#111316' }, body: { primary, nodes: [] }, eyes })

export const avatarDefs: any[] = [
  ...(doc as any).library.avatars.map((a: any) => ({ ...a, eyes: { ...a.eyes, ...(eyeFix[a.name] ?? {}) } })),
  extra('Rauti', '#9a6de3', { ...surfacePresets.diamond, roundness: 1 }),
  extra('Trixi', '#4fd08a', { ...surfacePresets.cone, morphRoundness: 0, tipRoundness: 1.2, baseRoundness: 1.6 }, { positionYLeft: 22, positionYRight: 22 }),
  extra('Tropi', '#5bc8e8', { ...surfacePresets.cone, morphRoundness: 0.6, tipRoundness: 0.2, baseRoundness: 2, width: 220 }, { positionYLeft: 22, positionYRight: 22 }),
  extra('Mopsi', '#e3996d', { ...surfacePresets.mickey, roundness: 1.5 }),
  extra('Dosi', '#e3c66d', { ...surfacePresets.cylinder, roundness: 1.2 }),
]
export const studioDoc: any = doc
