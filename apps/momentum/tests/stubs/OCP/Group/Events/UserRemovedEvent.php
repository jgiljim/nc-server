<?php

declare(strict_types=1);

namespace OCP\Group\Events;

use OCP\EventDispatcher\Event;
use OCP\IUser;

/**
 * Test-only stub reproducing the slice of \OCP\Group\Events\UserRemovedEvent's
 * public signature this app's {@see \OCA\Momentum\Listener\GroupMembershipListener}
 * depends on (operations.md Access Reconciliation — scoped scope, G12). Never
 * shipped to production — see glue-app/composer.json "autoload-dev" (OCP\ is
 * not in "autoload"). At runtime inside Nextcloud, the real server-provided
 * class is used.
 */
class UserRemovedEvent extends Event
{
    public function __construct(private readonly IUser $user)
    {
    }

    public function getUser(): IUser
    {
        return $this->user;
    }
}
