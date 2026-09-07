<?php

declare(strict_types=1);

namespace OCA\Momentum\Service;

use OCA\Momentum\AppInfo\Application;
use OCP\Files\Node;
use OCP\IConfig;

/**
 * Filters filesystem events down to what the Doc-Mgr pipeline can process
 * before a sync-work ledger row is ever written — mirrors context_chat's
 * FsEventService pattern (architecture.md § ⑨ Filesystem-event listener).
 * Reducing noise here, not just at the pipeline, keeps the ledger free of
 * files v1 will only ever reject (requirements.md F4: images and other
 * non-text-bearing formats are deferred to v2, not merely marked
 * `needs_ocr` at the intake edge).
 */
class FileAllowlist
{
    private const DEFAULT_ALLOWED_MIMETYPES = [
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'application/vnd.oasis.opendocument.text',
        'application/vnd.oasis.opendocument.spreadsheet',
        'application/vnd.oasis.opendocument.presentation',
    ];

    // 200 MB — mirrors architecture.md § ⑧'s zip-bomb uncompressed-size ceiling.
    private const DEFAULT_MAX_FILE_SIZE_BYTES = 209715200;

    public function __construct(private IConfig $config)
    {
    }

    public function isAllowed(Node $node): bool
    {
        if ($this->isExcludedPath($node->getPath())) {
            return false;
        }

        if (!$this->isAllowedMimetype($node->getMimetype())) {
            return false;
        }

        return $node->getSize() <= $this->maxFileSizeBytes();
    }

    /**
     * The mimetype-only half of {@see isAllowed()}, for callers serving an
     * already-accepted file back out (`FileController::show`,
     * `backlog/to_change.md` § G55 item 2) where the path-exclusion and
     * size-cap checks don't apply — those guard *intake*, not re-serving a
     * file the pipeline already accepted.
     */
    public function isAllowedMimetype(string $mimetype): bool
    {
        return in_array($mimetype, $this->allowedMimetypes(), true);
    }

    private function isExcludedPath(string $path): bool
    {
        $basename = basename($path);

        // Hidden files (dotfiles) and in-progress chunked-upload artifacts
        // (Nextcloud desktop/WebDAV clients write a ".part" sibling while
        // transferring) are never a finished document.
        return str_starts_with($basename, '.') || str_ends_with($basename, '.part');
    }

    /** @return list<string> */
    private function allowedMimetypes(): array
    {
        $configured = $this->config->getAppValue(
            Application::APP_ID,
            'mime_allowlist',
            implode(',', self::DEFAULT_ALLOWED_MIMETYPES),
        );

        return array_values(array_filter(array_map('trim', explode(',', $configured))));
    }

    private function maxFileSizeBytes(): int
    {
        return (int) $this->config->getAppValue(
            Application::APP_ID,
            'max_file_size_bytes',
            (string) self::DEFAULT_MAX_FILE_SIZE_BYTES,
        );
    }
}
