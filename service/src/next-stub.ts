// Die Actions laufen im Dienst ohne Next.js: Cache-Invalidierung entfällt, Cookies gibt es nur in der Web-App.
export const revalidatePath: (
  path: string,
  type?: "page" | "layout"
) => void = () => {}
export const cookies = async (): Promise<{
  get(name: string): { value: string } | undefined
  set(name: string, value: string, options?: object): void
}> => {
  throw new Error("Cookies sind im lokalen Dienst nicht verfügbar.")
}
