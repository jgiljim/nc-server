<?php

declare(strict_types=1);

namespace OCA\Momentum\Service\SyncWorkLedger;

/**
 * Exponential backoff for a failed ledger delivery attempt (db.md: "POSTs
 * them to the Doc-Mgr Backend ... with retry"). Doubles from a 5s base,
 * capped at 5 minutes so a backend outage doesn't push retries out for
 * hours — mirroring the Doc-Mgr Job Queue's own retry/dead-letter posture
 * (db.md § Common Facets). The number of attempts this backoff is applied to
 * is bounded by {@see DrainPass::DEFAULT_MAX_ATTEMPTS} / the
 * `ledger_max_attempts` app config; past it the row is dead-lettered
 * (`phase = 'dead'`) rather than backed off again (db.md § Attempts cap and
 * dead-letter tier — this superseded the earlier retry-forever posture,
 * decision_log.md 2026-07-30).
 */
final class RetryBackoff
{
    private const BASE_SECONDS = 5;
    private const MAX_SECONDS = 300;

    public static function secondsAfter(int $attempts): int
    {
        $attempts = max(1, $attempts);

        return min(self::MAX_SECONDS, self::BASE_SECONDS * (2 ** ($attempts - 1)));
    }
}
