<?php

declare(strict_types=1);

namespace OCA\Momentum\Tests\Controller;

use OCA\AppAPI\Attribute\AppAPIAuth;
use OCA\Momentum\Controller\AccessController;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\PublicPage;
use OCP\AppFramework\Http\DataResponse;
use OCP\Files\File;
use OCP\Files\Folder;
use OCP\Files\IRootFolder;
use OCP\Files\NotFoundException;
use OCP\IRequest;
use PHPUnit\Framework\TestCase;
use ReflectionAttribute;
use ReflectionMethod;

final class AccessControllerTest extends TestCase
{
    public function testVerifyIsGatedByAppApiAuthNotAnAdminSession(): void
    {
        // G54 regression guard: an authenticated non-ExApp NC session must
        // get 401/403 from /access/verify, not a cross-user visibility
        // oracle. #[NoAdminRequired] (the pre-fix attribute) admits any
        // logged-in session with no comparison of $uid to the caller —
        // #[AppAPIAuth] + #[PublicPage] is the only pairing that removes
        // that browser-session path entirely (see FileController's
        // docblock for why #[NoAdminRequired] alone can't gate an OCS
        // route). Both conditions below must hold, or this endpoint is
        // reachable by any logged-in NC user again.
        $attributeNames = array_map(
            static fn (ReflectionAttribute $attribute): string => $attribute->getName(),
            (new ReflectionMethod(AccessController::class, 'verify'))->getAttributes(),
        );

        self::assertContains(AppAPIAuth::class, $attributeNames);
        self::assertContains(PublicPage::class, $attributeNames);
        self::assertNotContains(NoAdminRequired::class, $attributeNames);
    }

    public function testReturnsVisibleTrueOnlyForFileIdsThatResolveToAFile(): void
    {
        $file = $this->createMock(File::class);

        $userFolder = $this->createMock(Folder::class);
        $userFolder->method('getById')->willReturnMap([
            [42, [$file]],
            [43, []],
        ]);

        $rootFolder = $this->createMock(IRootFolder::class);
        $rootFolder->method('getUserFolder')->with('alice')->willReturn($userFolder);

        $controller = new AccessController('momentum', $this->createMock(IRequest::class), $rootFolder);

        $response = $controller->verify('alice', [42, 43]);

        self::assertInstanceOf(DataResponse::class, $response);
        self::assertSame(['visible' => ['42' => true, '43' => false]], $response->getData());
    }

    public function testTreatsAFolderNodeMatchAsNotVisible(): void
    {
        $folderNode = $this->createMock(Folder::class);

        $userFolder = $this->createMock(Folder::class);
        $userFolder->method('getById')->with(42)->willReturn([$folderNode]);

        $rootFolder = $this->createMock(IRootFolder::class);
        $rootFolder->method('getUserFolder')->with('alice')->willReturn($userFolder);

        $controller = new AccessController('momentum', $this->createMock(IRequest::class), $rootFolder);

        $response = $controller->verify('alice', [42]);

        self::assertSame(['visible' => ['42' => false]], $response->getData());
    }

    public function testReturnsAllNotVisibleWhenTheUserHasNoHomeFolder(): void
    {
        $rootFolder = $this->createMock(IRootFolder::class);
        $rootFolder->method('getUserFolder')->with('ghost')->willThrowException(new NotFoundException());

        $controller = new AccessController('momentum', $this->createMock(IRequest::class), $rootFolder);

        $response = $controller->verify('ghost', [42, 43]);

        self::assertSame(['visible' => ['42' => false, '43' => false]], $response->getData());
    }

    public function testReturnsEmptyVisibleMapWhenNoFileIdsAreRequested(): void
    {
        $userFolder = $this->createMock(Folder::class);
        $rootFolder = $this->createMock(IRootFolder::class);
        $rootFolder->method('getUserFolder')->with('alice')->willReturn($userFolder);

        $controller = new AccessController('momentum', $this->createMock(IRequest::class), $rootFolder);

        $response = $controller->verify('alice', []);

        self::assertSame(['visible' => []], $response->getData());
    }
}
