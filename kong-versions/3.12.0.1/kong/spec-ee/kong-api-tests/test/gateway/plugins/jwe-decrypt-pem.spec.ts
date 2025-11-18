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

describe('@gke: Gateway Plugins: jwe-decrypt PEM', function () {
  const pemPath = '/jwedecryptpem';
  const serviceName = 'jwe-decrypt-service';
  const pemKeySetsName = 'pem-key-sets';
  const invalidTokenHeaders = {
    Authorization: `${authDetails.jwe['RSA-OAEP']['invalid-token']}`,
  };
  const validTokenHeaders = {
    Authorization: authDetails.jwe['RSA-OAEP']['valid-token'],
  };

  let serviceId: string;
  let pemRouteId: string;
  let keysId: string;
  let pemKeySetsId: string;

  const url = `${getBasePath({
    environment: isGateway() ? Environment.gateway.admin : undefined,
  })}`;
  const proxyUrl = `${getBasePath({
    app: 'gateway',
    environment: Environment.gateway.proxy,
  })}`;

  let basePayload: any;
  let pluginId: string;
  const pemKeys = {
    name: 'pem_key',
    set: { name: pemKeySetsName },
    pem: {
      public_key: authDetails.jwe['RSA-OAEP'].public_key,
      private_key: authDetails.jwe['RSA-OAEP'].private_key,
    },
    kid: '42',
  };

  const algList = ['ECDH-ES','ECDH-ES+A128KW', 'ECDH-ES+A192KW', 'ECDH-ES+A256KW'];

  before(async function () {
    const service = await createGatewayService(serviceName);
    serviceId = service.id;
    const routePem = await createRouteForService(serviceId, [pemPath]);
    pemRouteId = routePem.id;
    const pemKeySets = await createKeySetsForJweDecryptPlugin(pemKeySetsName);
    pemKeySetsId = pemKeySets.id;
    const jwkKey = await createEncryptedKeysForJweDecryptPlugin(pemKeys);
    keysId = jwkKey.id;

    basePayload = {
      name: 'jwe-decrypt',
      service: {
        id: serviceId,
      },
      route: {
        id: pemRouteId,
      },
    };
  });

  it('PEM: should not create jwe-decrypt plugin when config.key_sets is not supplied', async function () {
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

  it('PEM: should enable jwt-decrypt plugin with valid pem config on a service', async function () {
    const pluginPayload = {
      ...basePayload,
      config: { key_sets: [pemKeySetsName] },
    };

    const resp = await axios({
      method: 'post',
      url: `${url}/plugins`,
      data: pluginPayload,
    });
    logResponse(resp);

    expect(resp.status, 'Status should be 201').to.equal(201);
    expect(resp.data.config.key_sets[0], 'Should list key-sets').to.equal(
      pemKeySetsName
    );

    pluginId = resp.data.id;
    await waitForConfigRebuild();
  });

  it('PEM: should proxy request with valid token', async function () {
    const resp = await getNegative(`${proxyUrl}${pemPath}`, validTokenHeaders);
    logResponse(resp);

    expect(resp.status, 'Status should be 200').to.equal(200);
    const expectedValueFromJWE = `${authDetails.jwe['RSA-OAEP']['decrypted-data']}`;
    expect(resp.data.headers.Authorization, `Expected Authorization in resp to be '${expectedValueFromJWE}'`).to.equal(expectedValueFromJWE);
  });

  it('PEM: should accept valid token after deleting and recreating key set (cache refresh test)', async function () {
    // Delete key set and check if request fails
    await deleteKeySetsForJweDecryptPlugin(pemKeySetsId);
    await eventually(async () => {
      const resp = await axios({
        method: 'get',
        url: `${proxyUrl}${pemPath}`,
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
    const jwkKeySets = await createKeySetsForJweDecryptPlugin(pemKeySetsName);
    pemKeySetsId = jwkKeySets.id;
    const jwkKey = await createEncryptedKeysForJweDecryptPlugin(pemKeys);
    keysId = jwkKey.id;
    await eventually(async () => {
      const resp = await axios({
        method: 'get',
        url: `${proxyUrl}${pemPath}`,
        headers: validTokenHeaders,
        validateStatus: null
      });
      logResponse(resp);
      expect(resp.status, 'Status should be 200').to.equal(200);
      const expectedValueFromJWE = `${authDetails.jwe['RSA-OAEP']['decrypted-data']}`;
      expect(resp.data.headers.Authorization, `Expected Authorization in resp to be '${expectedValueFromJWE}'`).to.equal(expectedValueFromJWE);
    });
  });

  it('PEM: should not proxy request without a token', async function () {
    await eventually(async () => {
      const resp = await getNegative(`${proxyUrl}${pemPath}`);
      logResponse(resp);

      expect(resp.status, 'Status should be 403').to.equal(403);
      expect(resp.data.message, 'Should indicate token missing').to.equal(
        'could not find token'
      );
    });
  });
  
  for(const alg of algList){
    const jweDetails = authDetails.jwe[alg];
    it(`should proxy request with valid token uses ${jweDetails.description}`, async function () {
      //Update key with PEM
      const keysPayload = {
        kid: JSON.parse(jweDetails.jwk).kid,
        name: 'pem_key',
        set: { name: pemKeySetsName },
        pem: {
          public_key: jweDetails.public_key,
          private_key: jweDetails.private_key
        }
      };
      await patchEncryptedKeysForJweDecryptPlugin(keysId, keysPayload);

      //Send request with JWE
      await eventually(async () => {
        const resp = await axios({
          method: 'get',
          url: `${proxyUrl}${pemPath}`,
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

  it('PEM: should not proxy request with invalid token', async function () {
    const resp = await getNegative(
      `${proxyUrl}${pemPath}`,
      invalidTokenHeaders
    );
    logResponse(resp);

    expect(resp.status, 'Status should be 403').to.equal(403);

    expect(
      resp.data.message,
      'Should indicate token cannot be decrypted'
    ).to.equal('failed to decrypt token');
  });

  it('PEM: should patch jwe-decrypt plugin to disable auth and allow requests', async function () {
    const resp = await axios({
      method: 'patch',
      url: `${url}/plugins/${pluginId}`,
      data: {
        config: {
          strict: false,
        },
      },
    });
    logResponse(resp);

    expect(resp.status, 'Status should be 200').to.equal(200);
    await waitForConfigRebuild();
  });

  it('PEM: should proxy request without supplying a token', async function () {
    await eventually(async () => {
      const resp = await axios({
        url: `${proxyUrl}${pemPath}`,
      });
      logResponse(resp);
      
      expect(resp.status, 'Status should be 200').to.equal(200);
    });
  });

  it('PEM: should delete the jwe-decrypt plugin', async function () {
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
