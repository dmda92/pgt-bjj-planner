// Existing editing scenarios explicitly open cards before interacting with their fields.
export async function openAllPositions(page) {
    const summaries = page.locator('details.repertoire-position:not([open]) > summary');
    while (await summaries.count()) await summaries.first().click();
}
