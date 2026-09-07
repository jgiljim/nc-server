<?php

declare(strict_types=1);

namespace OCA\Momentum\Tests\Support;

use OCP\Files\File;
use OCP\IUser;

final class FakeFile implements File
{
    public function __construct(
        private int $id,
        private string $path,
        private string $mimetype = 'application/pdf',
        private string $content = '',
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
        return strlen($this->content);
    }

    public function getEtag(): string
    {
        return 'file-etag-' . $this->id;
    }

    public function getMTime(): int
    {
        return 0;
    }

    public function getContent(): string
    {
        return $this->content;
    }

    public function getOwner(): ?IUser
    {
        return null;
    }
}
