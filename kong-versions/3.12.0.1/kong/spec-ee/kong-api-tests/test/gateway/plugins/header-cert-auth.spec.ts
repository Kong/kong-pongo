import { authDetails } from '@fixtures';
import * as https from 'https';
import axios from 'axios';
import {
  createConsumer,
  createGatewayService,
  createRouteForService,
  Environment,
  expect,
  getBasePath,
  logResponse,
  clearAllKongResources,
  uploadCaCertificate,
  eventually,
  createPlugin,
  patchPlugin,
  describeWithWorkspaces,
} from '@support';

// Currently, only tests related to https://konghq.atlassian.net/browse/FTI-7021 are included.
// The issue affects cache key handling in incremental sync mode for multiple plugins in non-default workspaces, including the header-cert-auth plugin.
// Additional test cases for other scenarios may be added in the future.
describeWithWorkspaces('@smoke: Gateway Plugins: header-cert-auth', function () {
  const serviceName = 'header-cert-auth-service';
  const path = '/header-cert-auth';

  let proxyUrl: string;
  let serviceId: string;
  let routeId: string;
  let cert1: string;
  let pluginId: string;
  let basePayload: any;
  let validCertInHeaders: string;

  before(async function () {
    proxyUrl = `${getBasePath({
      app: 'gateway',
      environment: Environment.gateway.proxySec,
    })}`;

    // create a service and route
    const service = await createGatewayService(serviceName);
    serviceId = service.id;
    const route = await createRouteForService(serviceId, [path]);
    routeId = route.id;

    // upload the root certificate, and certificate has CN of KongSDET
    const resp = await uploadCaCertificate(authDetails.mtls_certs.root1);
    cert1 = resp.id;

    // create the base payload for header-cert-auth plugin
    basePayload = {
      name: 'header-cert-auth',
      service: {
        id: serviceId,
      },
      route: {
        id: routeId,
      },
      config: {
        ca_certificates: [cert1],
        certificate_header_format: 'base64_encoded',
        certificate_header_name: 'X-SSL-CERT',
        secure_source: false,
      },
    };

    // generate the valid cert in headers
    validCertInHeaders = authDetails.mtls_certs.entity1_cert.replace(
      /-----BEGIN [\w\s]+-----|-----END [\w\s]+-----|\r?\n/g,
      '',
    );
  });

  it('should create a header-cert-auth plugin', async function () {
    const resp = await createPlugin(basePayload);
    pluginId = resp.id;
  });

  it('should authenticate a request with valid consumer and certificate', async function () {
    await eventually(async () => {
      const resp1 = await axios({
        url: `${proxyUrl}${path}`,
        httpsAgent: new https.Agent({
          rejectUnauthorized: false,
        }),
        headers: {
          'X-SSL-CERT': validCertInHeaders,
        },
        validateStatus: null,
      });
      logResponse(resp1);
      expect(resp1.status, 'Status should be 401').to.equal(401);
      expect(resp1.data.message, 'Response message should mention TLS certificate failed verification').to.equal(
        'TLS certificate failed verification',
      );
    });

    // create a valid consumer named KongSDET
    await createConsumer('KongSDET');

    // request should pass now
    await eventually(async () => {
      const resp2 = await axios({
        url: `${proxyUrl}${path}`,
        httpsAgent: new https.Agent({
          rejectUnauthorized: false,
        }),
        headers: {
          'X-SSL-CERT': validCertInHeaders,
        },
        validateStatus: null,
      });
      logResponse(resp2);
      expect(resp2.status, 'Status should be 200').to.equal(200);
      expect(resp2.data.headers['X-Consumer-Username'], 'X-Consumer-Username should equal KongSDET').to.equal(
        'KongSDET',
      );
    });
  });

  it('should fail to authenticate a request with invalid certificate', async function () {
    await eventually(async () => {
      const resp1 = await axios({
        url: `${proxyUrl}${path}`,
        httpsAgent: new https.Agent({
          rejectUnauthorized: false,
        }),
        headers: {
          'X-SSL-CERT': '12345invalidcert67890',
        },
        validateStatus: null,
      });
      logResponse(resp1);
      expect(resp1.status, 'Status should be 500').to.equal(500);
    });
  });

  // Covers the bug described in https://konghq.atlassian.net/browse/FTI-7021.
  // The issue affects cache key handling in incremental sync mode for multiple plugins in non-default workspaces, including the header-cert-auth plugin.
  it('should authenticate a request with anonymous consumer', async function () {
    // update the plugin to enable anonymous consumer
    const payload = {
      ...basePayload,
      config: {
        ...basePayload.config,
        anonymous: 'anonymous-tester',
      },
    };
    await patchPlugin(pluginId, payload);

    // request should fail because no anonymous consumer created yet and no headers provided
    await eventually(async () => {
      const resp1 = await axios({
        url: `${proxyUrl}${path}`,
        httpsAgent: new https.Agent({
          rejectUnauthorized: false,
        }),
        validateStatus: null,
      });
      logResponse(resp1);
      expect(resp1.status, 'Status should be 500').to.equal(500);
      expect(resp1.data.message, 'Response message should be correct').to.equal(
        `anonymous consumer anonymous-tester is configured but doesn't exist`,
      );
    });

    // create the anonymous consumer
    await createConsumer('anonymous-tester');

    // request should pass now
    await eventually(async () => {
      const resp2 = await axios({
        url: `${proxyUrl}${path}`,
        httpsAgent: new https.Agent({
          rejectUnauthorized: false,
        }),
        validateStatus: null,
      });
      logResponse(resp2);
      expect(resp2.status, 'Status should be 200').to.equal(200);
      expect(resp2.data.headers['X-Anonymous-Consumer'], 'X-Anonymous-Consumer should be true').to.equal('true');
      expect(resp2.data.headers['X-Consumer-Username'], 'X-Consumer-Username should be anonymous-tester').to.equal(
        'anonymous-tester',
      );
    });
  });

  after(async function () {
    await clearAllKongResources();
  });
});
