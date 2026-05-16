/**
 * Resting Energy Requirement (RER) for dogs and cats.
 * Formula: RER = 70 × weight(kg)^0.75
 */
export function calculateRER(weightKg: number): number {
  return 70 * Math.pow(weightKg, 0.75);
}

/**
 * Daily calorie needs based on RER and goal.
 */
export function calculateDailyCalories(
  weightKg: number,
  goal: 'maintain' | 'lose' | 'gain'
): number {
  const rer = calculateRER(weightKg);
  const factors = { maintain: 1.6, lose: 1.0, gain: 1.8 };
  return Math.round(rer * factors[goal]);
}

/**
 * Daily portion in grams = (dailyCalories / caloriesPer100g) × 100
 */
export function calculateDailyPortion(
  weightKg: number,
  goal: 'maintain' | 'lose' | 'gain',
  calPer100g: number
): number {
  const calories = calculateDailyCalories(weightKg, goal);
  return Math.round((calories / calPer100g) * 100);
}

/**
 * Haversine distance between two lat/lng points (returns meters).
 */
export function haversineDistance(
  p1: { lat: number; lng: number },
  p2: { lat: number; lng: number }
): number {
  const R = 6371000;
  const dLat = ((p2.lat - p1.lat) * Math.PI) / 180;
  const dLng = ((p2.lng - p1.lng) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((p1.lat * Math.PI) / 180) *
      Math.cos((p2.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Daily water intake recommendation in ml.
 */
export function calculateDailyWater(weightKg: number): number {
  return Math.round(weightKg * 50);
}
