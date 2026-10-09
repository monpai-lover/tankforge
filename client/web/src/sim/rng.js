// Mirror of tg_shared::Rng (xorshift64*). BigInt keeps it bit-identical to the Rust version.
const MASK = (1n << 64n) - 1n;

export class Rng {
  constructor(seed) {
    let s = BigInt.asUintN(64, BigInt(seed));
    this.s = s === 0n ? 1n : s;
  }
  nextU64() {
    let x = this.s;
    x ^= x >> 12n;
    x = (x ^ (x << 25n)) & MASK;
    x ^= x >> 27n;
    this.s = x;
    return (x * 0x2545f4914f6cdd1dn) & MASK;
  }
  /** Uniform in [0, 1). */
  nextF32() {
    return Number(this.nextU64() >> 40n) / 16777216;
  }
}
