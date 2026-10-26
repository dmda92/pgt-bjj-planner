import {madridDate} from '../src/domain/plan-text-updates.ts';
// Recovery fixtures must stay entirely in the future: production protects past/today.
// Calendar arithmetic at UTC noon avoids DST changes in Europe/Madrid.
const today = madridDate();
const day = offset => {
    const date = new Date(`${today}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
};
export const recoveryStart = day(1);
export const recoveryEnd = day(62); // 61 daily sessions, excluding competition day.
export const recoveryFirstTournament = day(2);
export const recoverySecondTournament = day(3);
