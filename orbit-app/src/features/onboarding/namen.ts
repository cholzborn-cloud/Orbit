const NAMEN = [
  "Mira", "Juno", "Nika", "Lio", "Noa", "Romy", "Kian", "Milo",
  "Lina", "Elin", "Jona", "Mika", "June", "Lumi", "Nora", "Iris",
  "Nami", "Jade", "Ari", "Sam", "Ravi", "Luca", "Leni", "Runa",
  "Kira", "Ria", "Liv", "Ivo", "Levi", "Mila", "Nico", "Tala",
];

export function namensVorschlag(aktuell = ""): string {
  const namen = NAMEN.filter((name) => name.toLowerCase() !== aktuell.trim().toLowerCase());
  return namen[Math.floor(Math.random() * namen.length)];
}
