<?php

declare(strict_types=1);

namespace OCA\Momentum\Tests\Service;

use OCA\Momentum\Exception\TokenMintingException;
use OCA\Momentum\Service\TokenMinter;
use OCA\Momentum\Tests\Support\FakeConfig;
use OCA\Momentum\Tests\Support\FakeTimeFactory;
use PHPUnit\Framework\TestCase;

final class TokenMinterTest extends TestCase
{
    public function testMintsATokenSignedByTheConfiguredKeyWithExpectedClaims(): void
    {
        $keyPair = sodium_crypto_sign_keypair();
        $secretKey = sodium_crypto_sign_secretkey($keyPair);
        $publicKey = sodium_crypto_sign_publickey($keyPair);

        $config = new FakeConfig(
            systemValues: ['momentum_eddsa_private_key' => base64_encode($secretKey)],
            appValues: ['momentum' => ['nc_instance_id' => '7']],
        );
        $minter = new TokenMinter($config, new FakeTimeFactory(1_700_000_000));

        $token = $minter->mint(42, 'alice');

        $parts = explode('.', $token);
        self::assertCount(3, $parts);

        [$encodedHeader, $encodedPayload, $encodedSignature] = $parts;

        $header = json_decode(self::base64UrlDecode($encodedHeader), true, flags: JSON_THROW_ON_ERROR);
        self::assertSame('EdDSA', $header['alg']);

        $payload = json_decode(self::base64UrlDecode($encodedPayload), true, flags: JSON_THROW_ON_ERROR);
        self::assertSame(42, $payload['tenant_id']);
        self::assertSame(7, $payload['nc_instance_id']);
        self::assertSame('alice', $payload['nc_user_id']);
        self::assertSame(1_700_000_000, $payload['iat']);
        self::assertSame(1_700_000_060, $payload['exp']);

        $signingInput = $encodedHeader . '.' . $encodedPayload;
        $signature = self::base64UrlDecode($encodedSignature);

        self::assertTrue(sodium_crypto_sign_verify_detached($signature, $signingInput, $publicKey));
    }

    public function testThrowsWhenNoSigningKeyIsConfigured(): void
    {
        $minter = new TokenMinter(new FakeConfig(), new FakeTimeFactory(1_700_000_000));

        $this->expectException(TokenMintingException::class);
        $minter->mint(42, 'alice');
    }

    public function testThrowsWhenTheConfiguredSigningKeyIsNotValidBase64Ed25519(): void
    {
        $config = new FakeConfig(systemValues: ['momentum_eddsa_private_key' => 'not-a-valid-key']);
        $minter = new TokenMinter($config, new FakeTimeFactory(1_700_000_000));

        $this->expectException(TokenMintingException::class);
        $minter->mint(42, 'alice');
    }

    private static function base64UrlDecode(string $data): string
    {
        $padded = str_pad(strtr($data, '-_', '+/'), (int) (4 * ceil(strlen($data) / 4)), '=', STR_PAD_RIGHT);

        return (string) base64_decode($padded, true);
    }
}
