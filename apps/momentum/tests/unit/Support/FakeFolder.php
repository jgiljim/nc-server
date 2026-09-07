<?php

declare(strict_types=1);

namespace OCA\Momentum\Tests\Support;

use OCP\Files\Folder;
use OCP\Files\Node;
use OCP\Files\NotFoundException;
use OCP\IUser;

/**
 * Hand-written in-memory {@see Folder}, for testing {@see
 * \OCA\Momentum\Service\ScopedReconciliationPass}'s recursive subtree walk
 * without a real Nextcloud filesystem.
 */
final class FakeFolder implements Folder
{
    /**
     * @param list<Node> $children immediate children (files and subfolders)
     */
    public function __construct(
        private int $id,
        private string $path,
        private array $children = [],
    ) {
    }

    public function getId(): int
    {
        return $this->id;
    }

    public function getName(): string
    {
        return basename($this->path);
    }

    public function getPath(): string
    {
        return $this->path;
    }

    public function getMimetype(): string
    {
        return 'httpd/unix-directory';
    }

    public function getSize(): int
    {
        return 0;
    }

    public function getEtag(): string
    {
        return 'folder-etag';
    }

    public function getMTime(): int
    {
        return 0;
    }

    public function getById(int $id): array
    {
        foreach ($this->children as $child) {
            if ($child->getId() === $id) {
                return [$child];
            }
        }

        return [];
    }

    public function getDirectoryListing(): array
    {
        return $this->children;
    }

    public function getOwner(): ?IUser
    {
        return null;
    }

    public function get(string $path): Node
    {
        foreach ($this->children as $child) {
            if ($child->getName() === $path) {
                return $child;
            }
        }

        throw new NotFoundException();
    }
}
