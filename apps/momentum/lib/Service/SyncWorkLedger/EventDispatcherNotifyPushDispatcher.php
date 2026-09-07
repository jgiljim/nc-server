<?php

declare(strict_types=1);

namespace OCA\Momentum\Service\SyncWorkLedger;

use OCA\Momentum\AppInfo\Application;
use OCA\Momentum\Event\MomentumStatusPushEvent;
use OCA\Momentum\Service\AccessResolver;
use OCP\EventDispatcher\IEventDispatcher;
use OCP\Files\File;
use OCP\Files\IRootFolder;
use OCP\IConfig;
use Psr\Log\LoggerInterface;

/**
 * The real {@see NotifyPushDispatcher}: resolves the document's current
 * visible-uid set (architecture.md § ⑨ Access resolver: "local
 * getAccessList", review.md G6 resolution — "recipient resolution stays in
 * the Glue App"), then dispatches `momentum_status` to each uid via
 * `IEventDispatcher->dispatchTyped()` (api.md § POST /internal/sync-metadata
 * pseudocode), up to `momentum.notify_push_recipient_cap` (NC `IAppConfig`,
 * default 50). A visible-uid set beyond the cap is a deliberate skip, not an
 * error — KL-1 documents the fallback (those viewers rely on the frontend
 * poll / list re-fetch) and G30 is the tracked follow-up for a cap-hit
 * metric/alert; this class only logs it.
 */
final class EventDispatcherNotifyPushDispatcher implements NotifyPushDispatcher
{
    private const DEFAULT_RECIPIENT_CAP = 50;

    public function __construct(
        private readonly IRootFolder $rootFolder,
        private readonly AccessResolver $accessResolver,
        private readonly IEventDispatcher $eventDispatcher,
        private readonly IConfig $config,
        private readonly LoggerInterface $logger,
    ) {
    }

    public function push(StatusItem $item): void
    {
        $node = $this->rootFolder->getById($item->docId)[0] ?? null;

        if (!$node instanceof File) {
            // The file no longer exists in Nextcloud (or was never a plain
            // file) — nothing to resolve a recipient set from.
            return;
        }

        $uids = $this->accessResolver->resolveUids($node);

        if ($uids === []) {
            return;
        }

        $cap = $this->recipientCap();

        if (count($uids) > $cap) {
            $this->logger->info(
                'Skipping momentum_status notify_push for doc {docId}: {count} recipients exceeds cap {cap}',
                ['docId' => $item->docId, 'count' => count($uids), 'cap' => $cap],
            );

            return;
        }

        foreach ($uids as $uid) {
            $this->eventDispatcher->dispatchTyped(
                new MomentumStatusPushEvent($uid, $item->docId, $item->status, $item->reviewed),
            );
        }
    }

    private function recipientCap(): int
    {
        return (int) $this->config->getAppValue(
            Application::APP_ID,
            'notify_push_recipient_cap',
            (string) self::DEFAULT_RECIPIENT_CAP,
        );
    }
}
