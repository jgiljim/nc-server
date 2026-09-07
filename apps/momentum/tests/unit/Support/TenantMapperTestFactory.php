<?php

declare(strict_types=1);

namespace OCA\Momentum\Tests\Support;

use OCA\Momentum\Service\TenantMapper;
use OCP\Group\IGroup;
use OCP\IGroupManager;
use OCP\IUser;
use Psr\Log\NullLogger;

/**
 * `TenantMapper` is `final` (Nextcloud tenant-mapping semantics are not meant
 * to be overridden), so it cannot be `createMock()`-ed like an interface —
 * every test that needs one constructs a real instance over fakes. This
 * factory is for the common "nothing resolves" case: tests where the
 * tenant-mapping result is irrelevant to what's under test (e.g. the node has
 * no owner, so {@see \OCA\Momentum\Service\AccessResolver} never consults it).
 */
final class TenantMapperTestFactory
{
    public static function unresolvable(): TenantMapper
    {
        $groupManager = new class() implements IGroupManager {
            public function getUserGroupIds(IUser $user): array
            {
                return [];
            }

            public function get(string $gid): ?IGroup
            {
                return null;
            }
        };

        return new TenantMapper(new FakeDBConnection(), $groupManager, new NullLogger(), new FakeConfig());
    }
}
