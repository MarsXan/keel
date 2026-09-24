export function grade(score: number, bonus: boolean, late: boolean): string {
  if (score > 95) return 'A+';
  if (score > 90) return 'A';
  if (score > 85) return 'B+';
  if (score > 80) return 'B';
  if (score > 75) return 'C+';
  if (score > 70) return 'C';
  if (score > 65) return 'D+';
  if (score > 60) return 'D';
  if (bonus && score > 55) return 'E';
  if (late || score < 10) return 'F-';
  return 'F';
}
