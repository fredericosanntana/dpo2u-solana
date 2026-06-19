// Minimal ambient types for circomlibjs (no official @types package).
// Only the Poseidon surface KCS needs.
declare module 'circomlibjs' {
  export interface PoseidonField {
    /** Convert a field element to a JS BigInt. */
    toObject(x: unknown): bigint;
  }
  export interface Poseidon {
    (inputs: Array<bigint | number | string>): unknown;
    F: PoseidonField;
  }
  export function buildPoseidon(): Promise<Poseidon>;
}
