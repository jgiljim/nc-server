<?php

declare(strict_types=1);

namespace OCA\Momentum\Tests\Support;

use OCP\Files\Node;
use OCP\IUser;

final class FakeNode implements Node
{
    public function __construct(
        private int $id,
        private string $path,
        private string $mimetype,
        private int $size,
        private string $etag = 'etag-placeholder',
        private int $mtime = 0,
        private ?IUser $owner = null,
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
        return $this->mimetype;
    }

    public function getSize(): int
    {
        return $this->size;
    }

    public function getEtag(): string
    {
        return $this->etag;
    }

    public function getMTime(): int
    {
        return $this->mtime;
    }

    public function getOwner(): ?IUser
    {
        return $this->owner;
    }
}
