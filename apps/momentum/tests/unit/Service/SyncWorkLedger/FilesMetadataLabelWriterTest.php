<?php

declare(strict_types=1);

namespace OCA\Momentum\Tests\Service\SyncWorkLedger;

use OCA\Momentum\Service\SyncWorkLedger\FilesMetadataLabelWriter;
use OCA\Momentum\Service\SyncWorkLedger\StatusItem;
use OCA\Momentum\Service\TenantMapper;
use OCA\Momentum\Tests\Support\FakeConfig;
use OCA\Momentum\Tests\Support\FakeDBConnection;
use OCA\Momentum\Tests\Support\FakeResult;
use OCP\Files\IRootFolder;
use OCP\Files\Node;
use OCP\FilesMetadata\IFilesMetadataManager;
use OCP\FilesMetadata\Model\IFilesMetadata;
use OCP\IDBConnection;
use OCP\IGroupManager;
use OCP\IUser;
use OCP\SystemTag\ISystemTag;
use OCP\SystemTag\ISystemTagManager;
use OCP\SystemTag\ISystemTagObjectMapper;
use OCP\SystemTag\TagNotFoundException;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;

final class FilesMetadataLabelWriterTest extends TestCase
{
    /**
     * `TenantMapper` is `final` (see {@see \OCA\Momentum\Tests\Support\TenantMapperTestFactory}),
     * so it cannot be `createMock()`-ed — build a real instance over a
     * {@see FakeDBConnection} seeded with a single `tenant_id -> user_group_id` row, and a
     * `IGroupManager` stub reporting `$ownerUid` as a member of that group, so `resolve()`
     * (item 3's ownership check) succeeds for `$ownerUid` in addition to `groupIdForTenant()`
     * (item 2's tag-scoping lookup) succeeding for `$tenantId`.
     */
    private function tenantMapperFor(int $tenantId, string $groupId, string $ownerUid = 'alice'): TenantMapper
    {
        $groupManager = $this->createMock(IGroupManager::class);
        $groupManager->method('getUserGroupIds')->willReturn([$groupId]);

        return new TenantMapper(
            new FakeDBConnection([
                ['user_group_id' => $groupId, 'tenant_id' => $tenantId, 'backend_url' => 'https://example.test'],
            ]),
            $groupManager,
            $this->createMock(LoggerInterface::class),
            new FakeConfig(),
        );
    }

    private function rootFolderResolvingOwner(int $fileId, string $ownerUid): IRootFolder
    {
        $owner = $this->createMock(IUser::class);
        $owner->method('getUID')->willReturn($ownerUid);

        $node = $this->createMock(Node::class);
        $node->method('getOwner')->willReturn($owner);

        $rootFolder = $this->createMock(IRootFolder::class);
        $rootFolder->method('getById')->with($fileId)->willReturn([$node]);

        return $rootFolder;
    }

    public function testWritesFilesMetadataKeysAndAssignsAnExistingTagScopedToTheTenantGroup(): void
    {
        $metadata = $this->createMock(IFilesMetadata::class);
        $metadata->expects(self::exactly(2))->method('setString')
            ->willReturnMap([
                ['momentum-status', 'done', $metadata],
                ['momentum-type', 'sales_invoice', $metadata],
            ]);
        $metadata->expects(self::once())->method('setBool')
            ->with('momentum-reviewed', false)
            ->willReturnSelf();

        $filesMetadataManager = $this->createMock(IFilesMetadataManager::class);
        $filesMetadataManager->expects(self::once())->method('getMetadata')->with(42, true)->willReturn($metadata);
        $filesMetadataManager->expects(self::once())->method('saveMetadata')->with($metadata);

        $tag = $this->createConfiguredMock(ISystemTag::class, ['getId' => 'tag-1']);
        $tagManager = $this->createMock(ISystemTagManager::class);
        $tagManager->expects(self::once())->method('getTag')
            ->with('sales_invoice', false, true)
            ->willReturn($tag);
        $tagManager->expects(self::never())->method('createTag');
        $tagManager->expects(self::once())->method('getTagGroups')->with($tag)->willReturn([]);
        $tagManager->expects(self::once())->method('setTagGroups')->with($tag, ['acme-corp']);

        $tagObjectMapper = $this->createMock(ISystemTagObjectMapper::class);
        $tagObjectMapper->expects(self::once())->method('assignTags')->with('42', 'files', ['tag-1']);

        $writer = new FilesMetadataLabelWriter(
            $filesMetadataManager,
            $tagManager,
            $tagObjectMapper,
            $this->rootFolderResolvingOwner(42, 'alice'),
            $this->tenantMapperFor(12, 'acme-corp'),
            $this->createMock(LoggerInterface::class),
        );

        $writer->write(new StatusItem(42, 'done', 'sales_invoice', null, false, 12));
    }

    public function testWritesDirectionWhenPresent(): void
    {
        $setStringCalls = [];

        $metadata = $this->createMock(IFilesMetadata::class);
        $metadata->expects(self::exactly(3))->method('setString')
            ->willReturnCallback(function (string $key, string $value) use (&$setStringCalls, $metadata) {
                $setStringCalls[] = [$key, $value];

                return $metadata;
            });
        $metadata->method('setBool')->willReturnSelf();

        $filesMetadataManager = $this->createMock(IFilesMetadataManager::class);
        $filesMetadataManager->method('getMetadata')->willReturn($metadata);

        $tag = $this->createConfiguredMock(ISystemTag::class, ['getId' => 'tag-1']);
        $tagManager = $this->createMock(ISystemTagManager::class);
        $tagManager->method('getTag')->willReturn($tag);
        $tagManager->method('getTagGroups')->willReturn([]);

        $tagObjectMapper = $this->createMock(ISystemTagObjectMapper::class);

        $writer = new FilesMetadataLabelWriter(
            $filesMetadataManager,
            $tagManager,
            $tagObjectMapper,
            $this->rootFolderResolvingOwner(42, 'alice'),
            $this->tenantMapperFor(12, 'acme-corp'),
            $this->createMock(LoggerInterface::class),
        );

        $writer->write(new StatusItem(42, 'done', 'sales_invoice', 'inbound', false, 12));

        self::assertSame(
            [
                ['momentum-status', 'done'],
                ['momentum-type', 'sales_invoice'],
                ['momentum-direction', 'inbound'],
            ],
            $setStringCalls,
        );
    }

    public function testCreatesTheTagWhenItDoesNotExistYet(): void
    {
        $metadata = $this->createMock(IFilesMetadata::class);
        $metadata->method('setString')->willReturnSelf();
        $metadata->method('setBool')->willReturnSelf();

        $filesMetadataManager = $this->createMock(IFilesMetadataManager::class);
        $filesMetadataManager->method('getMetadata')->willReturn($metadata);

        $tag = $this->createConfiguredMock(ISystemTag::class, ['getId' => 'tag-2']);
        $tagManager = $this->createMock(ISystemTagManager::class);
        $tagManager->method('getTag')->willThrowException(new TagNotFoundException());
        $tagManager->expects(self::once())->method('createTag')->with('purchase_order', false, true)->willReturn($tag);
        $tagManager->method('getTagGroups')->willReturn([]);

        $tagObjectMapper = $this->createMock(ISystemTagObjectMapper::class);
        $tagObjectMapper->expects(self::once())->method('assignTags')->with('7', 'files', ['tag-2']);

        $writer = new FilesMetadataLabelWriter(
            $filesMetadataManager,
            $tagManager,
            $tagObjectMapper,
            $this->rootFolderResolvingOwner(7, 'bob'),
            $this->tenantMapperFor(12, 'acme-corp', 'bob'),
            $this->createMock(LoggerInterface::class),
        );

        $writer->write(new StatusItem(7, 'done', 'purchase_order', null, false, 12));
    }

    public function testDoesNotAssignATagWhenDocTypeIsUnknown(): void
    {
        $metadata = $this->createMock(IFilesMetadata::class);
        $metadata->method('setString')->willReturnSelf();
        $metadata->method('setBool')->willReturnSelf();

        $filesMetadataManager = $this->createMock(IFilesMetadataManager::class);
        $filesMetadataManager->method('getMetadata')->willReturn($metadata);

        $tagManager = $this->createMock(ISystemTagManager::class);
        $tagManager->expects(self::never())->method('getTag');
        $tagManager->expects(self::never())->method('createTag');

        $tagObjectMapper = $this->createMock(ISystemTagObjectMapper::class);
        $tagObjectMapper->expects(self::never())->method('assignTags');

        $writer = new FilesMetadataLabelWriter(
            $filesMetadataManager,
            $tagManager,
            $tagObjectMapper,
            $this->rootFolderResolvingOwner(42, 'alice'),
            $this->tenantMapperFor(12, 'acme-corp'),
            $this->createMock(LoggerInterface::class),
        );

        $writer->write(new StatusItem(42, 'processing', null, null, false, 12));
    }

    public function testDoesNotAddADuplicateGroupWhenTheTagIsAlreadyScopedToTheTenant(): void
    {
        $metadata = $this->createMock(IFilesMetadata::class);
        $metadata->method('setString')->willReturnSelf();
        $metadata->method('setBool')->willReturnSelf();

        $filesMetadataManager = $this->createMock(IFilesMetadataManager::class);
        $filesMetadataManager->method('getMetadata')->willReturn($metadata);

        $tag = $this->createConfiguredMock(ISystemTag::class, ['getId' => 'tag-1']);
        $tagManager = $this->createMock(ISystemTagManager::class);
        $tagManager->method('getTag')->willReturn($tag);
        $tagManager->method('getTagGroups')->willReturn(['acme-corp']);
        $tagManager->expects(self::never())->method('setTagGroups');

        $tagObjectMapper = $this->createMock(ISystemTagObjectMapper::class);

        $writer = new FilesMetadataLabelWriter(
            $filesMetadataManager,
            $tagManager,
            $tagObjectMapper,
            $this->rootFolderResolvingOwner(42, 'alice'),
            $this->tenantMapperFor(12, 'acme-corp'),
            $this->createMock(LoggerInterface::class),
        );

        $writer->write(new StatusItem(42, 'done', 'sales_invoice', null, false, 12));
    }

    public function testSkipsTheTagMirrorWhenTheTenantsGroupRegistrationIsRemovedAfterOwnershipIsConfirmed(): void
    {
        $metadata = $this->createMock(IFilesMetadata::class);
        $metadata->method('setString')->willReturnSelf();
        $metadata->method('setBool')->willReturnSelf();

        $filesMetadataManager = $this->createMock(IFilesMetadataManager::class);
        $filesMetadataManager->method('getMetadata')->willReturn($metadata);
        $filesMetadataManager->expects(self::once())->method('saveMetadata');

        $tagManager = $this->createMock(ISystemTagManager::class);
        $tagManager->expects(self::never())->method('getTag');
        $tagManager->expects(self::never())->method('createTag');
        $tagManager->expects(self::never())->method('setTagGroups');

        $tagObjectMapper = $this->createMock(ISystemTagObjectMapper::class);
        $tagObjectMapper->expects(self::never())->method('assignTags');

        $logger = $this->createMock(LoggerInterface::class);
        $logger->expects(self::once())->method('warning');

        $groupManager = $this->createMock(IGroupManager::class);
        $groupManager->method('getUserGroupIds')->willReturn(['acme-corp']);

        // belongsToPollingTenant()'s resolve() (item 3) and mirrorTag()'s
        // groupIdForTenant() (item 2) both read *PREFIX*momentum_tenants, so a
        // tenant that resolve() just confirmed ownership for can only fail
        // groupIdForTenant() if the registration is removed in the brief
        // window between the two reads — simulate that race directly against
        // the DB double rather than via `FakeDBConnection`'s single static
        // row set, which cannot represent two different results for the same
        // table across one `write()` call.
        $db = $this->createMock(IDBConnection::class);
        $db->method('executeQuery')->willReturnCallback(
            static fn (string $sql, array $params = []) => str_contains($sql, 'WHERE tenant_id')
                ? new FakeResult([])
                : new FakeResult([
                    ['user_group_id' => 'acme-corp', 'tenant_id' => 999, 'backend_url' => 'https://example.test'],
                ]),
        );

        $tenantMapper = new TenantMapper($db, $groupManager, $this->createMock(LoggerInterface::class), new FakeConfig());

        $writer = new FilesMetadataLabelWriter(
            $filesMetadataManager,
            $tagManager,
            $tagObjectMapper,
            $this->rootFolderResolvingOwner(42, 'alice'),
            $tenantMapper,
            $logger,
        );

        $writer->write(new StatusItem(42, 'done', 'sales_invoice', null, false, 999));
    }

    public function testSkipsTheWriteWhenTheFileOwnerBelongsToADifferentTenant(): void
    {
        $filesMetadataManager = $this->createMock(IFilesMetadataManager::class);
        $filesMetadataManager->expects(self::never())->method('getMetadata');
        $filesMetadataManager->expects(self::never())->method('saveMetadata');

        $tagManager = $this->createMock(ISystemTagManager::class);
        $tagManager->expects(self::never())->method('getTag');
        $tagManager->expects(self::never())->method('createTag');

        $tagObjectMapper = $this->createMock(ISystemTagObjectMapper::class);
        $tagObjectMapper->expects(self::never())->method('assignTags');

        // The file's real owner ('mallory') resolves to tenant 2, but the
        // item was polled on behalf of tenant 1 — the Doc-Mgr Backend
        // returned a doc_id that does not actually belong to the polling
        // tenant.
        $writer = new FilesMetadataLabelWriter(
            $filesMetadataManager,
            $tagManager,
            $tagObjectMapper,
            $this->rootFolderResolvingOwner(42, 'mallory'),
            $this->tenantMapperFor(2, 'mallory-corp', 'mallory'),
            $this->createMock(LoggerInterface::class),
        );

        $writer->write(new StatusItem(42, 'done', 'sales_invoice', null, false, 1));
    }

    public function testSkipsTheWriteWhenTheFileNoLongerExists(): void
    {
        $filesMetadataManager = $this->createMock(IFilesMetadataManager::class);
        $filesMetadataManager->expects(self::never())->method('getMetadata');

        $tagManager = $this->createMock(ISystemTagManager::class);
        $tagObjectMapper = $this->createMock(ISystemTagObjectMapper::class);
        $tagObjectMapper->expects(self::never())->method('assignTags');

        $rootFolder = $this->createMock(IRootFolder::class);
        $rootFolder->method('getById')->with(42)->willReturn([]);

        $writer = new FilesMetadataLabelWriter(
            $filesMetadataManager,
            $tagManager,
            $tagObjectMapper,
            $rootFolder,
            $this->tenantMapperFor(1, 'acme-corp'),
            $this->createMock(LoggerInterface::class),
        );

        $writer->write(new StatusItem(42, 'done', 'sales_invoice', null, false, 1));
    }

    public function testSkipsTheWriteWhenTheFileOwnerHasNoRegisteredTenant(): void
    {
        $filesMetadataManager = $this->createMock(IFilesMetadataManager::class);
        $filesMetadataManager->expects(self::never())->method('getMetadata');

        $tagManager = $this->createMock(ISystemTagManager::class);
        $tagObjectMapper = $this->createMock(ISystemTagObjectMapper::class);
        $tagObjectMapper->expects(self::never())->method('assignTags');

        $groupManager = $this->createMock(IGroupManager::class);
        $groupManager->method('getUserGroupIds')->willReturn([]);
        $tenantMapper = new TenantMapper(new FakeDBConnection(), $groupManager, $this->createMock(LoggerInterface::class), new FakeConfig());

        $writer = new FilesMetadataLabelWriter(
            $filesMetadataManager,
            $tagManager,
            $tagObjectMapper,
            $this->rootFolderResolvingOwner(42, 'ghost'),
            $tenantMapper,
            $this->createMock(LoggerInterface::class),
        );

        $writer->write(new StatusItem(42, 'done', 'sales_invoice', null, false, 1));
    }
}
