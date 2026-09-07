<?php

declare(strict_types=1);

namespace OCA\Momentum\Tests\Controller;

use OCA\Momentum\Controller\FileController;
use OCA\Momentum\Service\FileAllowlist;
use OCA\Momentum\Service\TenantMapper;
use OCA\Momentum\Tests\Support\FakeConfig;
use OCA\Momentum\Tests\Support\FakeDBConnection;
use OCP\AppFramework\Http\DataDownloadResponse;
use OCP\AppFramework\OCS\OCSForbiddenException;
use OCP\AppFramework\OCS\OCSNotFoundException;
use OCP\Files\File;
use OCP\Files\Folder;
use OCP\Files\IRootFolder;
use OCP\Files\NotFoundException;
use OCP\Files\NotPermittedException;
use OCP\IConfig;
use OCP\IGroupManager;
use OCP\IRequest;
use OCP\IUser;
use OCP\IUserManager;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;

final class FileControllerTest extends TestCase
{
    public function testReturnsFileContentAndMetadataWhenTheFileExists(): void
    {
        $file = $this->createMock(File::class);
        $file->method('getContent')->willReturn('file bytes');
        $file->method('getName')->willReturn('invoice.pdf');
        $file->method('getMimeType')->willReturn('application/pdf');

        $userFolder = $this->createMock(Folder::class);
        $userFolder->method('getById')->with(42)->willReturn([$file]);

        $rootFolder = $this->createMock(IRootFolder::class);
        $rootFolder->method('getUserFolder')->with('alice')->willReturn($userFolder);

        $controller = $this->buildController($rootFolder, $this->userManagerResolving('alice'), $this->tenantMapperResolvingEveryone());

        $response = $controller->show('alice', 42);

        self::assertInstanceOf(DataDownloadResponse::class, $response);
        self::assertSame('file bytes', $response->render());
        self::assertSame('application/pdf', $response->getHeaders()['Content-Type']);
        self::assertSame('attachment; filename="invoice.pdf"', $response->getHeaders()['Content-Disposition']);
    }

    public function testThrowsNotFoundWhenNoNodeMatchesTheFileId(): void
    {
        $userFolder = $this->createMock(Folder::class);
        $userFolder->method('getById')->with(42)->willReturn([]);

        $rootFolder = $this->createMock(IRootFolder::class);
        $rootFolder->method('getUserFolder')->with('alice')->willReturn($userFolder);

        $controller = $this->buildController($rootFolder, $this->userManagerResolving('alice'), $this->tenantMapperResolvingEveryone());

        $this->expectException(OCSNotFoundException::class);

        $controller->show('alice', 42);
    }

    public function testThrowsNotFoundWhenTheMatchedNodeIsAFolderNotAFile(): void
    {
        $folderNode = $this->createMock(Folder::class);

        $userFolder = $this->createMock(Folder::class);
        $userFolder->method('getById')->with(42)->willReturn([$folderNode]);

        $rootFolder = $this->createMock(IRootFolder::class);
        $rootFolder->method('getUserFolder')->with('alice')->willReturn($userFolder);

        $controller = $this->buildController($rootFolder, $this->userManagerResolving('alice'), $this->tenantMapperResolvingEveryone());

        $this->expectException(OCSNotFoundException::class);

        $controller->show('alice', 42);
    }

    public function testThrowsNotFoundWhenTheUserHasNoHomeFolder(): void
    {
        $rootFolder = $this->createMock(IRootFolder::class);
        $rootFolder->method('getUserFolder')->with('ghost')->willThrowException(new NotFoundException());

        $controller = $this->buildController($rootFolder, $this->userManagerResolving('ghost'), $this->tenantMapperResolvingEveryone());

        $this->expectException(OCSNotFoundException::class);

        $controller->show('ghost', 42);
    }

    public function testThrowsForbiddenWhenReadingTheFileContentIsNotPermitted(): void
    {
        $file = $this->createMock(File::class);
        $file->method('getContent')->willThrowException(new NotPermittedException());
        $file->method('getMimeType')->willReturn('application/pdf');

        $userFolder = $this->createMock(Folder::class);
        $userFolder->method('getById')->with(42)->willReturn([$file]);

        $rootFolder = $this->createMock(IRootFolder::class);
        $rootFolder->method('getUserFolder')->with('alice')->willReturn($userFolder);

        $controller = $this->buildController($rootFolder, $this->userManagerResolving('alice'), $this->tenantMapperResolvingEveryone());

        $this->expectException(OCSForbiddenException::class);

        $controller->show('alice', 42);
    }

    public function testThrowsForbiddenWhenTheFileOwnerHasNoRegisteredTenant(): void
    {
        $file = $this->createMock(File::class);
        $file->method('getMimeType')->willReturn('application/pdf');

        $userFolder = $this->createMock(Folder::class);
        $userFolder->method('getById')->with(42)->willReturn([$file]);

        $rootFolder = $this->createMock(IRootFolder::class);
        $rootFolder->method('getUserFolder')->with('ghost')->willReturn($userFolder);

        $groupManager = $this->createMock(IGroupManager::class);
        $groupManager->method('getUserGroupIds')->willReturn([]);
        $tenantMapper = new TenantMapper(new FakeDBConnection(), $groupManager, $this->createMock(LoggerInterface::class), new FakeConfig());

        $controller = $this->buildController($rootFolder, $this->userManagerResolving('ghost'), $tenantMapper);

        $this->expectException(OCSForbiddenException::class);

        $controller->show('ghost', 42);
    }

    public function testThrowsForbiddenWhenTheFileOwnerMatchesNoNextcloudAccount(): void
    {
        $file = $this->createMock(File::class);
        $file->method('getMimeType')->willReturn('application/pdf');

        $userFolder = $this->createMock(Folder::class);
        $userFolder->method('getById')->with(42)->willReturn([$file]);

        $rootFolder = $this->createMock(IRootFolder::class);
        $rootFolder->method('getUserFolder')->with('ghost')->willReturn($userFolder);

        $userManager = $this->createMock(IUserManager::class);
        $userManager->method('get')->with('ghost')->willReturn(null);

        $controller = $this->buildController($rootFolder, $userManager, $this->tenantMapperResolvingEveryone());

        $this->expectException(OCSForbiddenException::class);

        $controller->show('ghost', 42);
    }

    public function testThrowsForbiddenWhenTheFileOwnerMatchesMultipleRegisteredTenants(): void
    {
        $file = $this->createMock(File::class);
        $file->method('getMimeType')->willReturn('application/pdf');

        $userFolder = $this->createMock(Folder::class);
        $userFolder->method('getById')->with(42)->willReturn([$file]);

        $rootFolder = $this->createMock(IRootFolder::class);
        $rootFolder->method('getUserFolder')->with('alice')->willReturn($userFolder);

        $groupManager = $this->createMock(IGroupManager::class);
        $groupManager->method('getUserGroupIds')->willReturn(['acme-corp', 'other-corp']);
        $db = new FakeDBConnection([
            ['user_group_id' => 'acme-corp', 'tenant_id' => 1, 'backend_url' => 'https://acme.example'],
            ['user_group_id' => 'other-corp', 'tenant_id' => 2, 'backend_url' => 'https://other.example'],
        ]);
        $tenantMapper = new TenantMapper($db, $groupManager, $this->createMock(LoggerInterface::class), new FakeConfig());

        $controller = $this->buildController($rootFolder, $this->userManagerResolving('alice'), $tenantMapper);

        $this->expectException(OCSForbiddenException::class);

        $controller->show('alice', 42);
    }

    public function testThrowsForbiddenWhenTheResolvedMimetypeIsNotAllowlisted(): void
    {
        $file = $this->createMock(File::class);
        $file->method('getMimeType')->willReturn('image/jpeg');

        $userFolder = $this->createMock(Folder::class);
        $userFolder->method('getById')->with(42)->willReturn([$file]);

        $rootFolder = $this->createMock(IRootFolder::class);
        $rootFolder->method('getUserFolder')->with('alice')->willReturn($userFolder);

        $controller = $this->buildController($rootFolder, $this->userManagerResolving('alice'), $this->tenantMapperResolvingEveryone());

        $this->expectException(OCSForbiddenException::class);

        $controller->show('alice', 42);
    }

    public function testThrowsForbiddenWhenTheExAppIdHeaderIsMissing(): void
    {
        $rootFolder = $this->createMock(IRootFolder::class);

        $controller = $this->buildController(
            $rootFolder,
            $this->userManagerResolving('alice'),
            $this->tenantMapperResolvingEveryone(),
            $this->requestWithAppApiHeaders(exAppId: ''),
        );

        $this->expectException(OCSForbiddenException::class);

        $controller->show('alice', 42);
    }

    public function testThrowsForbiddenWhenTheAuthorizationAppApiHeaderIsMissing(): void
    {
        $rootFolder = $this->createMock(IRootFolder::class);

        $controller = $this->buildController(
            $rootFolder,
            $this->userManagerResolving('alice'),
            $this->tenantMapperResolvingEveryone(),
            $this->requestWithAppApiHeaders(authorizationAppApi: ''),
        );

        $this->expectException(OCSForbiddenException::class);

        $controller->show('alice', 42);
    }

    /**
     * Simulates `AppAPIAuthMiddleware` never having run at all (e.g. the
     * `app_api` app disabled/uninstalled) — no ExApp headers reach the
     * controller. Asserts the failure mode is `403`, not `200`: the exact
     * fragility that makes `backlog/to_change.md` § G55 HIGH rather than a
     * routine auth bug.
     */
    public function testThrowsForbiddenWhenBothExAppHeadersAreAbsentSimulatingAMissingMiddleware(): void
    {
        $rootFolder = $this->createMock(IRootFolder::class);

        $controller = $this->buildController(
            $rootFolder,
            $this->userManagerResolving('alice'),
            $this->tenantMapperResolvingEveryone(),
            $this->requestWithAppApiHeaders(exAppId: '', authorizationAppApi: ''),
        );

        $this->expectException(OCSForbiddenException::class);

        $controller->show('alice', 42);
    }

    private function buildController(
        IRootFolder $rootFolder,
        IUserManager $userManager,
        TenantMapper $tenantMapper,
        ?IRequest $request = null,
    ): FileController {
        $config = $this->createMock(IConfig::class);
        $config->method('getAppValue')->willReturnArgument(2);

        return new FileController(
            'momentum',
            $request ?? $this->requestWithAppApiHeaders(),
            $rootFolder,
            $userManager,
            $tenantMapper,
            new FileAllowlist($config),
        );
    }

    private function requestWithAppApiHeaders(string $exAppId = 'worker', string $authorizationAppApi = 'dGVzdDpzZWNyZXQ='): IRequest
    {
        $request = $this->createMock(IRequest::class);
        $request->method('getHeader')->willReturnMap([
            ['EX-APP-ID', $exAppId],
            ['AUTHORIZATION-APP-API', $authorizationAppApi],
        ]);

        return $request;
    }

    private function userManagerResolving(string $uid): IUserManager
    {
        $user = $this->createMock(IUser::class);
        $user->method('getUID')->willReturn($uid);

        $userManager = $this->createMock(IUserManager::class);
        $userManager->method('get')->with($uid)->willReturn($user);

        return $userManager;
    }

    /**
     * A `TenantMapper` that resolves any user with at least one group to
     * tenant `1` — the "owner is registered, uninteresting for this test"
     * default the file-content/not-found/not-permitted tests share.
     */
    private function tenantMapperResolvingEveryone(): TenantMapper
    {
        $groupManager = $this->createMock(IGroupManager::class);
        $groupManager->method('getUserGroupIds')->willReturn(['acme-corp']);

        $db = new FakeDBConnection([
            ['user_group_id' => 'acme-corp', 'tenant_id' => 1, 'backend_url' => 'https://acme.example'],
        ]);

        return new TenantMapper($db, $groupManager, $this->createMock(LoggerInterface::class), new FakeConfig());
    }
}
