import { randomInt } from "node:crypto";

/**
 * The IAU constellations whose Latin name is a single word. The two-word ones
 * (Canis Major, Ursa Minor, ...) are left out so every generated name is
 * exactly two words.
 */
export const CONSTELLATIONS = [
  "Andromeda",
  "Antlia",
  "Apus",
  "Aquarius",
  "Aquila",
  "Ara",
  "Aries",
  "Auriga",
  "Bootes",
  "Caelum",
  "Camelopardalis",
  "Cancer",
  "Capricornus",
  "Carina",
  "Cassiopeia",
  "Centaurus",
  "Cepheus",
  "Cetus",
  "Chamaeleon",
  "Circinus",
  "Columba",
  "Corvus",
  "Crater",
  "Crux",
  "Cygnus",
  "Delphinus",
  "Dorado",
  "Draco",
  "Equuleus",
  "Eridanus",
  "Fornax",
  "Gemini",
  "Grus",
  "Hercules",
  "Horologium",
  "Hydra",
  "Hydrus",
  "Indus",
  "Lacerta",
  "Leo",
  "Lepus",
  "Libra",
  "Lupus",
  "Lynx",
  "Lyra",
  "Mensa",
  "Microscopium",
  "Monoceros",
  "Musca",
  "Norma",
  "Octans",
  "Ophiuchus",
  "Orion",
  "Pavo",
  "Pegasus",
  "Perseus",
  "Phoenix",
  "Pictor",
  "Pisces",
  "Puppis",
  "Pyxis",
  "Reticulum",
  "Sagitta",
  "Sagittarius",
  "Scorpius",
  "Sculptor",
  "Scutum",
  "Serpens",
  "Sextans",
  "Taurus",
  "Telescopium",
  "Triangulum",
  "Tucana",
  "Vela",
  "Virgo",
  "Volans",
  "Vulpecula",
] as const;

const RANDOM_ATTEMPTS = 5;
const FIRST_NUMBER_SUFFIX = 2;

/** Two different constellations joined by a space, such as "Lyra Orion". */
export function randomConstellationName(): string {
  const firstIndex = randomInt(CONSTELLATIONS.length);
  // Drawing from one fewer and skipping past the first pick keeps the two different.
  const offset = randomInt(1, CONSTELLATIONS.length);
  const secondIndex = (firstIndex + offset) % CONSTELLATIONS.length;
  return `${CONSTELLATIONS[firstIndex]} ${CONSTELLATIONS[secondIndex]}`;
}

/**
 * A generated name that isn't in `takenNames`. After a few random draws that
 * all clash, the last one gets the lowest free number appended ("Lyra Orion 2").
 */
export function unusedConstellationName(
  takenNames: ReadonlySet<string>,
  generateName: () => string = randomConstellationName,
): string {
  let name = generateName();
  for (let attempt = 1; attempt < RANDOM_ATTEMPTS && takenNames.has(name); attempt++) {
    name = generateName();
  }
  if (!takenNames.has(name)) {
    return name;
  }
  let suffix = FIRST_NUMBER_SUFFIX;
  while (takenNames.has(`${name} ${suffix}`)) {
    suffix++;
  }
  return `${name} ${suffix}`;
}
