const SCALE = 1_000_000n;

function toScaledInteger(value: string | number): bigint {
  const text = String(value).trim();
  if (!/^\d+(?:\.\d{1,6})?$/.test(text)) {
    throw new Error(
      "Quantity must be a non-negative decimal with up to 6 places.",
    );
  }
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(6, "0"));
}

function formatScaledInteger(value: bigint): string {
  const whole = value / SCALE;
  const fraction = (value % SCALE)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function convertQuantityToBase(
  quantity: string | number,
  baseQuantityPerUnit: string | number,
): string {
  const quantityScaled = toScaledInteger(quantity);
  const factorScaled = toScaledInteger(baseQuantityPerUnit);
  return formatScaledInteger((quantityScaled * factorScaled) / SCALE);
}

export function formatWeightGrams(grams: string | number): string {
  const total = toScaledInteger(grams);
  const thousandGrams = 1000n * SCALE;
  const kilogramCount = total / thousandGrams;
  const remainder = total % thousandGrams;
  if (remainder === 0n) return `${kilogramCount} KG`;

  const rubacGrams = 250n * SCALE;
  const tuminGrams = 125n * SCALE;
  if (remainder % rubacGrams === 0n) {
    return `${kilogramCount} KG + ${remainder / rubacGrams} Rubac`;
  }
  if (remainder % tuminGrams === 0n) {
    return `${kilogramCount} KG + ${remainder / tuminGrams} Tumin`;
  }
  return `${kilogramCount} KG + ${formatScaledInteger(remainder)} g`;
}
