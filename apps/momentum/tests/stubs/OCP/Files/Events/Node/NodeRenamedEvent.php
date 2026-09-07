<?php

declare(strict_types=1);

namespace OCP\Files\Events\Node;

use OCP\EventDispatcher\Event;
use OCP\Files\Node;

/**
 * Test-only stub reproducing \OCP\Files\Events\Node\NodeRenamedEvent's
 * public signature. Never shipped to production — see glue-app/composer.json
 * "autoload-dev" (OCP\ is not in "autoload"). At runtime inside Nextcloud,
 * the real server-provided class is used.
 */
class NodeRenamedEvent extends Event
{
    public function __construct(private Node $source, private Node $target)
    {
    }

    public function getSource(): Node
    {
        return $this->source;
    }

    public function getTarget(): Node
    {
        return $this->target;
    }
}
