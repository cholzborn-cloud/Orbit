export const MAX_GROUP_MEMBERS = 6

export function validateGroupMemberCount(count: number) {
  return count <= MAX_GROUP_MEMBERS ? null : "Höchstens 6 Orbis je Gruppe"
}
