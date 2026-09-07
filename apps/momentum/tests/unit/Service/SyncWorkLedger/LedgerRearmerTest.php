<?php

declare(strict_types=1);

namespace OCA\Momentum\Tests\Service\SyncWorkLedger;

use OCA\Momentum\Service\SyncWorkLedger\LedgerRearmer;
use OCA\Momentum\Service\TenantMapper;
use OCA\Momentum\Tests\Support\FakeConfig;
use OCA\Momentum\Tests\Support\FakeDBConnection;
use OCA\Momentum\Tests\Support\FakeSyncWorkLedgerRepository;
use OCA\Momentum\Tests\Support\FakeTimeFactory;
use OCP\Files\File;
use OCP\Files\Folder;
use OCP\Files\IRootFolder;
use OCP\Files\NotFoundException;
use OCP\IGroupManager;
use OCP\IUser;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;

final class LedgerRearmerTest extends TestCase
{
    private const BACKEND_URL = 'https://acme.momentum.example/api';

    private function tenantMapperFor(int $tenantId, string $groupId): TenantMapper
    {
        $groupManager = $this->createMock(IGroupManager::class);
        $groupManager->method('getUserGroupIds')->willReturn([$groupId]);

        return new TenantMapper(
            new FakeDBConnection([
                ['user_group_id' => $groupId, 'tenant_id' => $tenantId, 'backend_url' => self::BACKEND_URL],
            ]),
            $groupManager,
            $this->createMock(LoggerInterface::class),
            new FakeConfig(),
        );
    }

    private function rootFolderResolving(int $fileId, string $ownerUid): IRootFolder
    {
        $owner = $this->createMock(IUser::class);
        $owner->method('getUID')->willReturn($ownerUid);

        $node = $this->createMock(File::class);
        $node->method('getId')->willReturn($fileId);
        $node->method('getMimetype')->willReturn('application/pdf');
        $node->method('getPath')->willReturn("/$ownerUid/files/Invoices/acme.pdf");
        $node->method('getEtag')->willReturn('etag-1');
        $node->method('getMTime')->willReturn(1_700_000_000);
        $node->method('getOwner')->willReturn($owner);

        $userFolder = $this->createMock(Folder::class);
        $userFolder->method('get')->with('/Invoices/acme.pdf')->willReturn($node);

        $rootFolder = $this->createMock(IRootFolder::class);
        $rootFolder->method('getUserFolder')->with($ownerUid)->willReturn($userFolder);

        return $rootFolder;
    }

    public function testRearmResolvesTheFileAndArmsTheLedgerRowByTheResolvedFileId(): void
    {
        $user = $this->createConfiguredMock(IUser::class, ['getUID' => 'alice']);
        $ledger = new FakeSyncWorkLedgerRepository();

        $rearmer = new LedgerRearmer(
            $this->tenantMapperFor(42, 'acme-corp'),
            $this->rootFolderResolving(99, 'alice'),
            $ledger,
            new FakeTimeFactory(1_700_000_000),
            new FakeConfig(),
            $this->createMock(LoggerInterface::class),
        );

        $rearmer->rearm($user, '/Invoices/acme.pdf');

        self::assertCount(1, $ledger->rearmed);
        self::assertSame(99, $ledger->rearmed[0]['docId']);
        self::assertSame(42, $ledger->rearmed[0]['payload']['tenant_id']);
        self::assertSame(self::BACKEND_URL, $ledger->rearmed[0]['payload']['backend_url']);
        self::assertSame('alice', $ledger->rearmed[0]['payload']['nc_user_id']);
        self::assertSame('alice', $ledger->rearmed[0]['payload']['owner_uid']);
    }

    public function testRearmSkipsWithoutErrorWhenTheActingUserDoesNotOwnTheFile(): void
    {
        $user = $this->createConfiguredMock(IUser::class, ['getUID' => 'bob']);
        $ledger = new FakeSyncWorkLedgerRepository();

        $userFolder = $this->createMock(Folder::class);
        $userFolder->method('get')->willThrowException(new NotFoundException());

        $rootFolder = $this->createMock(IRootFolder::class);
        $rootFolder->method('getUserFolder')->with('bob')->willReturn($userFolder);

        $rearmer = new LedgerRearmer(
            $this->tenantMapperFor(42, 'acme-corp'),
            $rootFolder,
            $ledger,
            new FakeTimeFactory(1_700_000_000),
            new FakeConfig(),
            $this->createMock(LoggerInterface::class),
        );

        $rearmer->rearm($user, '/Shared/acme.pdf');

        self::assertSame([], $ledger->rearmed);
    }

    public function testRearmSkipsWithoutErrorWhenTheActingUserHasNoRegisteredTenant(): void
    {
        $user = $this->createConfiguredMock(IUser::class, ['getUID' => 'nobody']);
        $ledger = new FakeSyncWorkLedgerRepository();

        $groupManager = $this->createMock(IGroupManager::class);
        $groupManager->method('getUserGroupIds')->willReturn(['some-other-group']);
        $tenantMapper = new TenantMapper(
            new FakeDBConnection([
                ['user_group_id' => 'acme-corp', 'tenant_id' => 42, 'backend_url' => self::BACKEND_URL],
            ]),
            $groupManager,
            $this->createMock(LoggerInterface::class),
            new FakeConfig(),
        );

        $rootFolder = $this->createMock(IRootFolder::class);
        $rootFolder->expects(self::never())->method('getUserFolder');

        $rearmer = new LedgerRearmer(
            $tenantMapper,
            $rootFolder,
            $ledger,
            new FakeTimeFactory(1_700_000_000),
            new FakeConfig(),
            $this->createMock(LoggerInterface::class),
        );

        $rearmer->rearm($user, '/Invoices/acme.pdf');

        self::assertSame([], $ledger->rearmed);
    }
}
