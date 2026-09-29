// Seeded PRNG from the legacy page: keeps sprinkle placement identical between loads.
export const SPK = ["#FF6FA6", "#FFC93C", "#7CC5FF", "#8BE0C6", "#C89BFF", "#FF5C74", "#fff"];

let s = 42;
export function rnd(): number {
  s = (s * 9301 + 49297) % 233280;
  return s / 233280;
}

export function pick<T>(a: T[]): T {
  return a[Math.floor(rnd() * a.length)];
}
