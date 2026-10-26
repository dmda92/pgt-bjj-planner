/** Parse the competition timer without changing persisted seconds or Tabata rules. */
export function durationSeconds(value: string): number | null {
    const match = /^(\d{1,2}):([0-5]\d)$/.exec(value);
    if (!match) return null;
    const seconds = Number(match[1]) * 60 + Number(match[2]);
    return seconds >= 1 && seconds <= 3600 ? seconds : null;
}

export const durationError = 'Introduce minutos y segundos (por ejemplo, 3:00), entre 0:01 y 60:00.';
