import { randomInt } from 'node:crypto';

export const CONSTELLATIONS = [
  'Andromeda',
  'Antlia',
  'Apus',
  'Aquarius',
  'Aquila',
  'Ara',
  'Aries',
  'Auriga',
  'Bootes',
  'Caelum',
  'Camelopardalis',
  'Cancer',
  'Capricornus',
  'Carina',
  'Cassiopeia',
  'Centaurus',
  'Cepheus',
  'Cetus',
  'Chamaeleon',
  'Circinus',
  'Columba',
  'Corvus',
  'Crater',
  'Crux',
  'Cygnus',
  'Delphinus',
  'Dorado',
  'Draco',
  'Equuleus',
  'Eridanus',
  'Fornax',
  'Gemini',
  'Grus',
  'Hercules',
  'Horologium',
  'Hydra',
  'Hydrus',
  'Indus',
  'Lacerta',
  'Leo',
  'Lepus',
  'Libra',
  'Lupus',
  'Lynx',
  'Lyra',
  'Mensa',
  'Microscopium',
  'Monoceros',
  'Musca',
  'Norma',
  'Octans',
  'Ophiuchus',
  'Orion',
  'Pavo',
  'Pegasus',
  'Perseus',
  'Phoenix',
  'Pictor',
  'Pisces',
  'Puppis',
  'Pyxis',
  'Reticulum',
  'Sagitta',
  'Sagittarius',
  'Scorpius',
  'Sculptor',
  'Scutum',
  'Serpens',
  'Sextans',
  'Taurus',
  'Telescopium',
  'Triangulum',
  'Tucana',
  'Vela',
  'Virgo',
  'Volans',
  'Vulpecula',
] as const;

const RANDOM_ATTEMPTS = 5;
const FIRST_NUMBER_SUFFIX = 2;

export function randomConstellationName(): string {
  const firstIndex = randomInt(CONSTELLATIONS.length);
  const offset = randomInt(1, CONSTELLATIONS.length);
  const secondIndex = (firstIndex + offset) % CONSTELLATIONS.length;
  return `${CONSTELLATIONS[firstIndex]} ${CONSTELLATIONS[secondIndex]}`;
}

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
