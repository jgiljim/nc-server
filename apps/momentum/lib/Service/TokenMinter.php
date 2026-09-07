<?php

declare(strict_types=1);

namespace OCA\Momentum\Service;

use OCA\Momentum\Exception\TokenMintingException;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\IConfig;

/**
 * Mints the short-lived EdDSA-signed identity token the Doc-Mgr Backend
 * verifies on the ingest hop (architecture.md § ⑨ Tenant mapper + token
 * minter; requirements.md ADR-002; identity-flow_nc_doc-mgr.md § Token
 * Structure).
 *
 * Produces a compact, JWT-shaped `header.payload.signature` token (EdDSA /
 * Ed25519 via libsodium — a PHP core extension, no composer dependency)
 * carrying claims `tenant_id`, `nc_instance_id`, `nc_user_id`, `iat`, `exp`
 * (TTL ≤ 60 s). The private signing key never leaves this app; only the
 * corresponding public key (`nc_instances.token_verify_key`) is given to
 * the Doc-Mgr Backend.
 */
final class TokenMinter
{
    private const TTL_SECONDS = 60;
    private const APP_ID = 'momentum';

    public function __construct(
        private readonly IConfig $config,
        private readonly ITimeFactory $timeFactory,
    ) {
    }

    /**
     * @throws TokenMintingException no signing key deployed to this NC instance
     */
    public function mint(int $tenantId, string $ncUserId): string
    {
        $secretKey = base64_decode($this->config->getSystemValueString('momentum_eddsa_private_key'), true);

        if ($secretKey === false || $secretKey === '' || strlen($secretKey) !== SODIUM_CRYPTO_SIGN_SECRETKEYBYTES) {
            throw new TokenMintingException(
                'No valid EdDSA signing key deployed to this NC instance'
                    . ' (system config "momentum_eddsa_private_key").',
            );
        }

        $ncInstanceId = (int) $this->config->getAppValue(self::APP_ID, 'nc_instance_id', '0');

        $now = $this->timeFactory->getTime();

        $header = ['alg' => 'EdDSA', 'typ' => 'JWT'];
        $payload = [
            'tenant_id' => $tenantId,
            'nc_instance_id' => $ncInstanceId,
            'nc_user_id' => $ncUserId,
            'iat' => $now,
            'exp' => $now + self::TTL_SECONDS,
        ];

        $signingInput = self::base64UrlEncode(json_encode($header, JSON_THROW_ON_ERROR))
            . '.' . self::base64UrlEncode(json_encode($payload, JSON_THROW_ON_ERROR));

        $signature = sodium_crypto_sign_detached($signingInput, $secretKey);

        return $signingInput . '.' . self::base64UrlEncode($signature);
    }

    private static function base64UrlEncode(string $data): string
    {
        return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
    }
}
