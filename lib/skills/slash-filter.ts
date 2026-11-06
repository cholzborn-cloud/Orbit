export function filterSlashSkills<
  T extends { name: string; description?: string },
>(skills: T[], query: string) {
  const normalized = query.trim().toLowerCase().replace(/^\//, "")
  return skills.filter((skill) =>
    `${skill.name} ${skill.description ?? ""}`
      .toLowerCase()
      .includes(normalized)
  )
}
