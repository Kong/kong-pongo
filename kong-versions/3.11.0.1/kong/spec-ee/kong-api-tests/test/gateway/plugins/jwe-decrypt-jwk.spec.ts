import { authDetails } from '@fixtures';
import {
  createEncryptedKeysForJweDecryptPlugin,
  createGatewayService,
  createKeySetsForJweDecryptPlugin,
  patchEncryptedKeysForJweDecryptPlugin,
  createRouteForService,
  Environment,
  eventually,
  expect,
  getBasePath,
  getNegative,
  isGateway,
  logResponse,
  postNegative,
  waitForConfigRebuild,
  clearAllKongResources,
  deleteKeySetsForJweDecryptPlugin,
} from '@support';
import axios from 'axios';

describe('@gke: Gateway Plugins: jwe-decrypt JWK', function () {
  const jwkPath = '/jwedecryptjwk';
  const serviceName = 'jwe-decrypt-service';
  const jwkKeySetsName = 'jwk-key-sets';
  const invalidTokenHeaders = {
    Authorization: `${authDetails.jwe['RSA-OAEP']['invalid-token']}`,
  };
  const validTokenHeaders = {
    Authorization: `${authDetails.jwe['RSA-OAEP']['valid-token']}`,
  };

  let serviceId: string;
  let jwkRouteId: string;
  let jwkKeySetsId: string;
  let keysId: string;

  const url = `${getBasePath({
    environment: isGateway() ? Environment.gateway.admin : undefined,
  })}`;
  const proxyUrl = `${getBasePath({
    app: 'gateway',
    environment: Environment.gateway.proxy,
  })}`;

  let basePayload: any;
  let pluginId: string;

  const jwkKeys = {
    name: 'jwk_key',
    set: { name: jwkKeySetsName },
    jwk: authDetails.jwe['RSA-OAEP'].jwk,
    kid: '42',
  };

  before(async function () {
    const service = await createGatewayService(serviceName);
    serviceId = service.id;
    const routeJwk = await createRouteForService(serviceId, [jwkPath]);
    jwkRouteId = routeJwk.id;
    const jwkKeySets = await createKeySetsForJweDecryptPlugin(jwkKeySetsName);
    jwkKeySetsId = jwkKeySets.id;
    const jwkKey = await createEncryptedKeysForJweDecryptPlugin(jwkKeys);
    keysId = jwkKey.id;

    basePayload = {
      name: 'jwe-decrypt',
      service: {
        id: serviceId,
      },
      route: {
        id: jwkRouteId,
      },
    };
  });

  const algList = ['ECDH-ES', 'A128KW', 'A192KW', 'A256KW', 'ECDH-ES+A128KW', 'ECDH-ES+A192KW', 'ECDH-ES+A256KW', 'A128GCMKW', 'A192GCMKW', 'A256GCMKW'];

  it('JWK: should not create jwe-decrypt plugin when config.key_sets is not supplied', async function () {
    const pluginPayload = {
      ...basePayload,
      config: {},
    };
    const resp = await postNegative(`${url}/plugins`, pluginPayload);
    logResponse(resp);

    expect(resp.status, 'Status should be 400').to.equal(400);
    expect(resp.data.name, 'Should indicate schema violation').to.equal(
      'schema violation'
    );
    expect(
      resp.data.fields.config.key_sets,
      'Should indicate key-sets is a required field'
    ).to.equal('required field missing');
  });

  it('JWK: should enable jwt-decrypt plugin with valid jwk config', async function () {
    const pluginPayload = {
      ...basePayload,
      config: { key_sets: [jwkKeySetsName] },
    };

    const resp = await axios({
      method: 'post',
      url: `${url}/plugins`,
      data: pluginPayload,
    });
    logResponse(resp);

    expect(resp.status, 'Status should be 201').to.equal(201);
    expect(resp.data.config.key_sets[0], 'Should list key-sets').to.equal(
      jwkKeySetsName
    );

    pluginId = resp.data.id;

    await waitForConfigRebuild();
  });

  it('JWK: should not proxy request without a token', async function () {
    await eventually(async () => {
      const resp = await getNegative(`${proxyUrl}${jwkPath}`);
      logResponse(resp);

      expect(resp.status, 'Status should be 403').to.equal(403);
      expect(resp.data.message, 'Should indicate token missing').to.equal(
        'could not find token'
      );
    });
  });

  it('JWK: should not proxy request with invalid token', async function () {
    console.log(invalidTokenHeaders);
    const resp = await getNegative(
      `${proxyUrl}${jwkPath}`,
      invalidTokenHeaders
    );
    logResponse(resp);

    expect(resp.status, 'Status should be 403').to.equal(403);

    expect(
      resp.data.message,
      'Should indicate token cannot be decrypted'
    ).to.equal('failed to decrypt token');
  });

  it('JWK: should proxy request with valid token uses RSA-OAEP', async function () {
    const resp = await axios({
      method: 'get',
      url: `${proxyUrl}${jwkPath}`,
      headers: validTokenHeaders,
      validateStatus: null
    });

    logResponse(resp);
    expect(resp.status, 'Status should be 200').to.equal(200);
    const expectedValueFromJWE = `${authDetails.jwe['RSA-OAEP']['decrypted-data']}`;
    expect(resp.data.headers.Authorization, `Expected Authorization in resp to be '${expectedValueFromJWE}'`).to.equal(expectedValueFromJWE);
  });

  // Coverage for KAG-7260. And it is skipped because the bug is not fixed yet.
  xit('JWK: should accept valid token after deleting and recreating key set (cache refresh test)', async function () {
    // Delete key set and check if request fails
    await deleteKeySetsForJweDecryptPlugin(jwkKeySetsId);
    await eventually(async () => {
      const resp = await axios({
        method: 'get',
        url: `${proxyUrl}${jwkPath}`,
        headers: validTokenHeaders,
        validateStatus: null
      });
      logResponse(resp);
      expect(resp.status, 'Status should be 403').to.equal(403);
      expect(
        resp.data.message,
        'Should indicate token cannot be decrypted'
      ).to.equal('failed to decrypt token');
    });

    // Recreate key set and check if request succeeds
    const jwkKeySets = await createKeySetsForJweDecryptPlugin(jwkKeySetsName);
    jwkKeySetsId = jwkKeySets.id;
    const jwkKey = await createEncryptedKeysForJweDecryptPlugin(jwkKeys);
    keysId = jwkKey.id;
    await eventually(async () => {
      const resp = await axios({
        method: 'get',
        url: `${proxyUrl}${jwkPath}`,
        headers: validTokenHeaders,
        validateStatus: null
      });
      logResponse(resp);
      expect(resp.status, 'Status should be 200').to.equal(200);
      const expectedValueFromJWE = `${authDetails.jwe['RSA-OAEP']['decrypted-data']}`;
      expect(resp.data.headers.Authorization, `Expected Authorization in resp to be '${expectedValueFromJWE}'`).to.equal(expectedValueFromJWE);
    });
  });

  for(const alg of algList){
    const jweDetails = authDetails.jwe[alg];
    it(`should proxy request with valid token uses ${jweDetails.description}`, async function () {
      //Update key with JWK
      const keysPayload = {
        name: 'jwk_key',
        set: { name: jwkKeySetsName },
        jwk: jweDetails.jwk,
        kid: JSON.parse(jweDetails.jwk).kid
      };
      await patchEncryptedKeysForJweDecryptPlugin(keysId, keysPayload);

      //Send request with JWE
      await eventually(async () => {
        const resp = await axios({
          method: 'get',
          url: `${proxyUrl}${jwkPath}`,
          headers: {
            Authorization: `Bearer ${jweDetails.jwe}`
          },
          validateStatus: null
        });
        logResponse(resp);
        expect(resp.status, 'Status should be 200').to.equal(200);
        const expectedAuthValueFromJWE = `Bearer ${jweDetails.jwt}`;
        expect(resp.data.headers.Authorization, `Expected Authorization in resp to be '${expectedAuthValueFromJWE}'`).to.equal(expectedAuthValueFromJWE);
      });
    });
  }

  // Coverage for JWK with only public key: KAG-390
  it('JWK: should not proxy request when token is valid but JWK contains only public key', async function () {
    //Update key with JWK
    const keysPayload = {
      name: 'jwk_key',
      set: { name: jwkKeySetsName },
      jwk: authDetails.jwe['RSA-OAEP']['jwk-public-only'],
      kid: JSON.parse(authDetails.jwe['RSA-OAEP']['jwk-public-only']).kid
    };
    await patchEncryptedKeysForJweDecryptPlugin(keysId, keysPayload);

    //Send request with JWE  
    const resp = await getNegative(
      `${proxyUrl}${jwkPath}`,
      validTokenHeaders
    );
    logResponse(resp);

    expect(resp.status, 'Status should be 403').to.equal(403);

    expect(
      resp.data.message,
      'Should indicate token cannot be decrypted'
    ).to.equal('failed to decrypt token');
  });

  it('JWK: should patch jwe-decrypt plugin to disable auth and allow requests', async function () {
    await eventually(async () => {
      const resp = await axios({
        method: 'patch',
        url: `${url}/plugins/${pluginId}`,
        data: { 
          config: {strict: false}
       },
      });
      logResponse(resp);
      expect(resp.status, 'Status should be 200').to.equal(200);
    });
  });

  it('JWK: should proxy request without supplying a token', async function () {
    await eventually(async () => {
      const resp = await axios({
        url: `${proxyUrl}${jwkPath}`,
      });
      logResponse(resp);

      expect(resp.status, 'Status should be 200').to.equal(200);
    });
  });

  it('should delete the jwe-decrypt plugin', async function () {
    const resp = await axios({
      method: 'delete',
      url: `${url}/plugins/${pluginId}`,
    });
    logResponse(resp);

    expect(resp.status, 'Status should be 204').to.equal(204);
  });

  after(async function () {
    await clearAllKongResources()
  });
});
