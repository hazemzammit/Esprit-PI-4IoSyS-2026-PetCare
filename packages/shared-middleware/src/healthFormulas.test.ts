import { describe, it, expect } from 'vitest';
import {
  calculateRER,
  calculateDailyCalories,
  calculateDailyPortion,
  haversineDistance,
  calculateDailyWater,
} from './healthFormulas';

describe('Health Formulas', () => {
  describe('calculateRER', () => {
    it('should return 70 × weight^0.75', () => {
      // 10kg → 70 × 10^0.75 = 70 × 5.623 ≈ 393.6
      const rer = calculateRER(10);
      expect(rer).toBeCloseTo(393.6, 0);
    });

    it('should handle small weights', () => {
      const rer = calculateRER(2);
      expect(rer).toBeGreaterThan(0);
      expect(rer).toBeLessThan(200);
    });

    it('should handle large weights', () => {
      const rer = calculateRER(50);
      expect(rer).toBeGreaterThan(1000);
    });
  });

  describe('calculateDailyCalories', () => {
    it('should return higher calories for gain vs maintain vs lose', () => {
      const gain = calculateDailyCalories(10, 'gain');
      const maintain = calculateDailyCalories(10, 'maintain');
      const lose = calculateDailyCalories(10, 'lose');

      expect(gain).toBeGreaterThan(maintain);
      expect(maintain).toBeGreaterThan(lose);
    });

    it('should return a whole number', () => {
      const result = calculateDailyCalories(12, 'maintain');
      expect(Number.isInteger(result)).toBe(true);
    });
  });

  describe('calculateDailyPortion', () => {
    it('should increase portion when calories per 100g are lower', () => {
      const lowCal = calculateDailyPortion(10, 'maintain', 200);
      const highCal = calculateDailyPortion(10, 'maintain', 400);
      expect(lowCal).toBeGreaterThan(highCal);
    });

    it('should return a whole number', () => {
      const result = calculateDailyPortion(10, 'maintain', 350);
      expect(Number.isInteger(result)).toBe(true);
    });
  });

  describe('haversineDistance', () => {
    it('should return 0 for identical points', () => {
      const d = haversineDistance(
        { lat: 36.8065, lng: 10.1815 },
        { lat: 36.8065, lng: 10.1815 }
      );
      expect(d).toBeCloseTo(0, 0);
    });

    it('should return ~111km for 1° latitude', () => {
      const d = haversineDistance(
        { lat: 0, lng: 0 },
        { lat: 1, lng: 0 }
      );
      // 1 degree latitude ≈ 111,195m
      expect(d).toBeCloseTo(111195, -3);
    });

    it('should be symmetric', () => {
      const p1 = { lat: 36.8065, lng: 10.1815 }; // Tunis
      const p2 = { lat: 48.8566, lng: 2.3522 }; // Paris
      expect(haversineDistance(p1, p2)).toBeCloseTo(haversineDistance(p2, p1), 0);
    });
  });

  describe('calculateDailyWater', () => {
    it('should return 50ml per kg', () => {
      expect(calculateDailyWater(10)).toBe(500);
      expect(calculateDailyWater(5)).toBe(250);
    });
  });
});
