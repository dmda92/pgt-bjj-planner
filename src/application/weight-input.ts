/** Preserve decimal precision; accept either Spanish comma or decimal point. */
export function weightValue(text: string): number | null {
    return text.trim() === "" ? null : Number(text.trim().replace(",", "."));
}

export function weightError(text: string): string {
    const weight = weightValue(text);
    return weight === null || (/^\s*(?:\d+(?:[.,]\d*)?|[.,]\d+)\s*$/.test(text) && Number.isFinite(weight) && weight > 0 && weight < 500)
        ? "" : "Introduce un peso mayor que 0 y menor que 500 kg.";
}
