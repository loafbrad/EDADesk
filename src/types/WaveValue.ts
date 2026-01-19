/**
 * WaveValue - Arbitrary precision integer for HDL waveform values
 *
 * Uses BigInt internally to support bit widths up to 2^31 - 1 bits.
 * Provides formatting, parsing, and clamping utilities.
 */

export type DisplayFormat = 'hex' | 'decimal' | 'binary';

export class WaveValue {
  private readonly _value: bigint;

  constructor(value: bigint | number | string, radix: number = 10) {
    if (typeof value === 'bigint') {
      this._value = value;
    } else if (typeof value === 'number') {
      // Handle regular numbers (including floating point by truncating)
      this._value = BigInt(Math.trunc(value));
    } else if (typeof value === 'string') {
      this._value = WaveValue.parseString(value, radix);
    } else {
      this._value = 0n;
    }
  }

  /**
   * Parse a string value with optional prefix detection
   */
  private static parseString(str: string, defaultRadix: number): bigint {
    const trimmed = str.trim().toLowerCase();

    if (trimmed === '' || trimmed === '-') {
      return 0n;
    }

    // Detect prefixes
    if (trimmed.startsWith('0x') || trimmed.startsWith('0h')) {
      return BigInt('0x' + trimmed.slice(2).replace(/[^0-9a-f]/gi, '') || '0');
    }
    if (trimmed.startsWith('0b')) {
      const binStr = trimmed.slice(2).replace(/[^01]/g, '') || '0';
      return BigInt('0b' + binStr);
    }
    if (trimmed.startsWith('0o')) {
      const octStr = trimmed.slice(2).replace(/[^0-7]/g, '') || '0';
      return BigInt('0o' + octStr);
    }

    // Use default radix
    try {
      if (defaultRadix === 16) {
        return BigInt('0x' + trimmed.replace(/[^0-9a-f]/gi, '') || '0');
      } else if (defaultRadix === 2) {
        return BigInt('0b' + trimmed.replace(/[^01]/g, '') || '0');
      } else {
        // Decimal - handle negative numbers
        const isNegative = trimmed.startsWith('-');
        const digits = trimmed.replace(/[^0-9]/g, '') || '0';
        const result = BigInt(digits);
        return isNegative ? -result : result;
      }
    } catch {
      return 0n;
    }
  }

  /**
   * Get the raw bigint value
   */
  get value(): bigint {
    return this._value;
  }

  /**
   * Create a WaveValue clamped to a specific bit width (unsigned)
   */
  clamp(bitWidth: number): WaveValue {
    if (bitWidth <= 0) {
      return new WaveValue(0n);
    }

    // Create mask for the bit width: (2^bitWidth) - 1
    const mask = (1n << BigInt(bitWidth)) - 1n;

    // Clamp negative values to 0, positive values to mask
    let clamped = this._value;
    if (clamped < 0n) {
      clamped = 0n;
    } else if (clamped > mask) {
      clamped = mask;
    }

    return new WaveValue(clamped);
  }

  /**
   * Apply a bit mask (AND operation)
   */
  mask(bitWidth: number): WaveValue {
    if (bitWidth <= 0) {
      return new WaveValue(0n);
    }
    const maskValue = (1n << BigInt(bitWidth)) - 1n;
    return new WaveValue(this._value & maskValue);
  }

  /**
   * Format as hexadecimal string (without 0x prefix)
   */
  toHex(minDigits?: number): string {
    const hex = this._value.toString(16).toUpperCase();
    if (minDigits && hex.length < minDigits) {
      return hex.padStart(minDigits, '0');
    }
    return hex;
  }

  /**
   * Format as binary string (without 0b prefix)
   */
  toBinary(minDigits?: number): string {
    const bin = this._value.toString(2);
    if (minDigits && bin.length < minDigits) {
      return bin.padStart(minDigits, '0');
    }
    return bin;
  }

  /**
   * Format as decimal string
   */
  toDecimal(): string {
    return this._value.toString(10);
  }

  /**
   * Format based on display format and bit width
   */
  format(displayFormat: DisplayFormat, bitWidth?: number): string {
    switch (displayFormat) {
      case 'hex': {
        const digits = bitWidth ? Math.ceil(bitWidth / 4) : undefined;
        return this.toHex(digits);
      }
      case 'binary': {
        return this.toBinary(bitWidth);
      }
      case 'decimal':
      default:
        return this.toDecimal();
    }
  }

  /**
   * Convert to JavaScript number (may lose precision for large values)
   */
  toNumber(): number {
    // Check if value fits in safe integer range
    if (this._value >= BigInt(Number.MIN_SAFE_INTEGER) &&
        this._value <= BigInt(Number.MAX_SAFE_INTEGER)) {
      return Number(this._value);
    }
    // For larger values, convert but precision may be lost
    return Number(this._value);
  }

  /**
   * Check if value fits in JavaScript's safe integer range
   */
  isSafeInteger(): boolean {
    return this._value >= BigInt(Number.MIN_SAFE_INTEGER) &&
           this._value <= BigInt(Number.MAX_SAFE_INTEGER);
  }

  /**
   * Check equality
   */
  equals(other: WaveValue | bigint | number): boolean {
    if (other instanceof WaveValue) {
      return this._value === other._value;
    }
    return this._value === BigInt(other);
  }

  /**
   * Compare values
   */
  compare(other: WaveValue | bigint | number): number {
    const otherValue = other instanceof WaveValue ? other._value : BigInt(other);
    if (this._value < otherValue) return -1;
    if (this._value > otherValue) return 1;
    return 0;
  }

  /**
   * Check if value is zero
   */
  isZero(): boolean {
    return this._value === 0n;
  }

  /**
   * Check if value is one (useful for single-bit signals)
   */
  isOne(): boolean {
    return this._value === 1n;
  }

  /**
   * Create from various input formats with format detection
   */
  static parse(input: string, format?: DisplayFormat): WaveValue {
    const trimmed = input.trim();

    // Auto-detect format from prefix
    if (trimmed.toLowerCase().startsWith('0x') || trimmed.toLowerCase().startsWith('0h')) {
      return new WaveValue(trimmed, 16);
    }
    if (trimmed.toLowerCase().startsWith('0b')) {
      return new WaveValue(trimmed, 2);
    }

    // Use specified format
    switch (format) {
      case 'hex':
        return new WaveValue(trimmed, 16);
      case 'binary':
        return new WaveValue(trimmed, 2);
      case 'decimal':
      default:
        return new WaveValue(trimmed, 10);
    }
  }

  /**
   * Create a WaveValue representing zero
   */
  static zero(): WaveValue {
    return new WaveValue(0n);
  }

  /**
   * Create a WaveValue representing one
   */
  static one(): WaveValue {
    return new WaveValue(1n);
  }

  /**
   * Create from a number (convenience method)
   */
  static fromNumber(n: number): WaveValue {
    return new WaveValue(n);
  }

  /**
   * Create from a bigint (convenience method)
   */
  static fromBigInt(n: bigint): WaveValue {
    return new WaveValue(n);
  }

  /**
   * Serialize to JSON-compatible format
   */
  toJSON(): string {
    return this._value.toString();
  }

  /**
   * Create from JSON-serialized format
   */
  static fromJSON(json: string | number): WaveValue {
    if (typeof json === 'number') {
      return new WaveValue(json);
    }
    return new WaveValue(json, 10);
  }

  /**
   * String representation for debugging
   */
  toString(): string {
    return this._value.toString();
  }
}

/**
 * Helper to check if a value can be used as a WaveValue input
 */
export function isWaveValueCompatible(value: unknown): value is bigint | number | string {
  return typeof value === 'bigint' || typeof value === 'number' || typeof value === 'string';
}

/**
 * Convert any compatible value to WaveValue
 */
export function toWaveValue(value: bigint | number | string | WaveValue): WaveValue {
  if (value instanceof WaveValue) {
    return value;
  }
  return new WaveValue(value);
}
