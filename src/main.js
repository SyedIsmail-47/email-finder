import { Actor, log } from 'apify';

import { normalizeInput } from './input.js';
import { runEmailFinder } from './run.js';

await Actor.main(async () => {
    const input = normalizeInput(await Actor.getInput());
    log.info(
        `Finding emails for ${input.people.length} person${input.people.length === 1 ? '' : 's'}. `
        + `At most ${input.maxConcurrentPerDomain} checks run at once per domain. `
        + `Network timeout is ${input.smtpTimeoutMs}ms.`,
    );
    await runEmailFinder(input);
});
