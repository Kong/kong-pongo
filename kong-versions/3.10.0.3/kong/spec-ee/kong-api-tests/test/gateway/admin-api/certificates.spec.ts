import { authDetails } from '@fixtures';
import axios from 'axios';
import {
  uploadCaCertificate,
  logResponse,
  getBasePath,
  isGateway,
  Environment,
  expect,
  deleteCaCertificate,
  getGatewayContainerLogs,
  findRegex,
  getKongContainerName,
  isGwHybrid,
  resetGatewayContainerEnvVariable
} from '@support';

describe.skip('@smoke: Gateway Admin API: CA Certificates', function () {
  const kongContainerName = isGwHybrid() ? 'kong-dp1' : getKongContainerName();
  const adminUrl = `${getBasePath({
    environment: isGateway() ? Environment.gateway.admin : undefined,
  })}`;
  let certId: string;

  it('should create a CA Certificate', async function () {
    const resp = await uploadCaCertificate(authDetails.mtls_certs.root1);
    certId = resp.id;
  });

  // Case to cover the bug: https://konghq.atlassian.net/browse/KAG-6845
  it('should patch "tags"', async function () {
    const resp = await axios({
      method: 'patch',
      url: `${adminUrl}/ca_certificates/${certId}`,
      data: {
        tags: ['tag-updated']
      },
      validateStatus: null
    });
    logResponse(resp);
    const currentLogs = getGatewayContainerLogs(kongContainerName, 20);
    const isLogFound = findRegex(`attempt to call method 'select_by_ca_certificate' \\(a nil value\\)`, currentLogs);
    expect(
      isLogFound,
      'Should not see error logs for the test case'
    ).to.be.false;
    expect(resp.status, 'Status should be 200').to.equal(200);
  });

  it('should delete a certificate', async function () {
    await deleteCaCertificate(certId)
  });

});



// ********* Note *********
// In order for this test to successfully run you need to have defined the following environment variables in all Kong nodes
// AWS_REGION: us-east-2
// AWS_ACCESS_KEY_ID: ${{ actualSecret}}
// AWS_SECRET_ACCESS_KEY: ${{ actualSecret }}
// ********* End **********

// The test is skipped now because the fixes for the issue FTI-6466 are not yet merged into the master branch.
// Case related to FTI-6466. We expect the Kong reload to work successfully after updating the kong_ssl_cert with Vault.
xdescribe('Gateway: read ssl certificates from vault', function () {
  it('should reload correctly after updating environment variables to Vault references - FTI-6466', async function () {
    await resetGatewayContainerEnvVariable(
      {
        KONG_SSL_CERT: '{vault://aws/gateway-secret-test/kong_ssl_cert}',
        KONG_SSL_CERT_KEY: '{vault://aws/gateway-secret-test/kong_ssl_cert_key}'
      },
      getKongContainerName()
    );
    if (isGwHybrid()) {
      await resetGatewayContainerEnvVariable(
        {
          KONG_SSL_CERT: '{vault://aws/gateway-secret-test/kong_ssl_cert}',
          KONG_SSL_CERT_KEY: '{vault://aws/gateway-secret-test/kong_ssl_cert_key}'
        },
        'kong-dp1'
      );
    }
  });

  after(async function () {
    //Reset the environment variables to default value
    await resetGatewayContainerEnvVariable(
      {
        KONG_SSL_CERT: '/etc/acme-certs/cert.pem',
        KONG_SSL_CERT_KEY: '/etc/acme-certs/key.pem'
      },
      getKongContainerName()
    );
    if (isGwHybrid()) {
      await resetGatewayContainerEnvVariable(
        {
          KONG_SSL_CERT: '/etc/acme-certs/cert.pem',
          KONG_SSL_CERT_KEY: '/etc/acme-certs/key.pem'
        },
        'kong-dp1'
      );
    }
  });
});