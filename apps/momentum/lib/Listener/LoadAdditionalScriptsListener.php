<?php

declare(strict_types=1);

namespace OCA\Momentum\Listener;

use OCA\Files\Event\LoadAdditionalScriptsEvent;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\Util;

/**
 * Injects the Files-app integration bundle (js/momentum-files.js — the M4.14
 * AI Filing custom View + M4.16 Ask AI sidebar tab, see files-entry.ts) on
 * every Files page. `LoadAdditionalScriptsEvent` (fired by the `files` app
 * itself when it renders) is the real Nextcloud mechanism third-party apps
 * use to extend Files-app chrome — the same one `systemtags`'s own
 * `LoadAdditionalScriptsListener` uses for its View/sidebar-tab script
 * (apps/systemtags/lib/Listeners/LoadAdditionalScriptsListener.php in
 * nextcloud/server). Registered in Application.php's `register()`.
 */
class LoadAdditionalScriptsListener implements IEventListener
{
    public function handle(Event $event): void
    {
        if (!$event instanceof LoadAdditionalScriptsEvent) {
            return;
        }

        Util::addScript('momentum', 'momentum-files');
    }
}
