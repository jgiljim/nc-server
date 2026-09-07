<?php

declare(strict_types=1);

namespace OCP\Files;

use OCP\IUser;

/**
 * Test-only stub reproducing the slice of \OCP\Files\Node's public signature
 * this app's file-serving controller and filesystem-event listener depend on
 * (architecture.md § ⑨). Never shipped to production — see
 * glue-app/composer.json "autoload-dev" (OCP\ is not in "autoload"). At
 * runtime inside Nextcloud, the real server-provided interface is used.
 */
interface Node
{
    public function getId(): int;

    public function getName(): string;

    public function getPath(): string;

    public function getMimetype(): string;

    public function getSize(): int;

    public function getEtag(): string;

    public function getMTime(): int;

    public function getOwner(): ?IUser;
}
