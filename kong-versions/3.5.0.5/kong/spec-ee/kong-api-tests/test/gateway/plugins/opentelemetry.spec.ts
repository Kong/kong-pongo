import axios from 'axios';
import {
  expect,
  Environment,
  getBasePath,
  postNegative,
  createGatewayService,
  deleteGatewayService,
  deleteGatewayRoute,
  randomString,
  isGwHybrid,
  isLocalDatabase,
  wait,
  logResponse,
  deletePlugin,
  createRouteForService,
  resetGatewayContainerEnvVariable,
  getKongContainerName,
  logDebug,
} from '@support';

describe('Gateway Plugins: OpenTelemetry', function () {
  this.timeout(50000);

  const isHybrid = isGwHybrid();
  const isLocalDb = isLocalDatabase();
  const waitTime = 5000;
  const hybridWaitTime = 8000;
  const jaegerWait = 20000;
  const configEndpoint = 'http://jaeger:4318/v1/traces';
  const paths = ['/jaegertest1', '/jaegertest2', '/jaegertest3'];

  const host = `${getBasePath({
    environment: Environment.gateway.hostName,
  })}`;
  const jaegerTracesEndpoint = `http://${host}:16686/api/traces?service=kong&lookback=2m&limit=10`;

  const url = `${getBasePath({
    environment: Environment.gateway.admin,
  })}/plugins`;

  const proxyUrl = `${getBasePath({
    environment: Environment.gateway.proxy,
  })}`;

  const gwContainerName = getKongContainerName();

  let serviceId: string;
  let routeId: string;
  let pluginId: string;
  let totalTraces: number;
  let maxAllowedTraces: number;

  before(async function () {
    // enable kong opel tracing for requests for this test
    await resetGatewayContainerEnvVariable(
      {
        KONG_TRACING_INSTRUMENTATIONS: 'request',
        KONG_TRACING_SAMPLING_RATE: 1,
      },
      gwContainerName
    );
    if (isHybrid) {
      await resetGatewayContainerEnvVariable(
        {
          KONG_TRACING_INSTRUMENTATIONS: 'request',
          KONG_TRACING_SAMPLING_RATE: 1,
        },
        'kong-dp1'
      );
    }

    //  wait longer if running kong natively
    await wait(gwContainerName === 'kong-cp' ? 2000 : 5000); // eslint-disable-line no-restricted-syntax
    const service = await createGatewayService(randomString());
    serviceId = service.id;
    const route = await createRouteForService(serviceId, ['/']);
    routeId = route.id;

    await wait(jaegerWait); // eslint-disable-line no-restricted-syntax
  });

  it('should not create opel plugin with invalid config.endpoint', async function () {
    const pluginPayload = {
      name: 'opentelemetry',
      config: {
        endpoint: 'test',
      },
    };

    const resp = await postNegative(url, pluginPayload);
    logResponse(resp);

    expect(resp.status, 'Status should be 400').to.equal(400);
    expect(resp.data.message, 'Should have correct error message').to.contain(
      `schema violation (config.endpoint: missing host in url)`
    );
  });

  it('should create otel plugin with valid jaeger config.endpoint', async function () {
    const pluginPayload = {
      name: 'opentelemetry',
      config: {
        endpoint: configEndpoint,
      },
    };

    const resp = await axios({
      method: 'post',
      url,
      data: pluginPayload,
    });
    logResponse(resp);

    pluginId = resp.data.id;
    expect(resp.status, 'Status should be 201').to.equal(201);

    await wait(hybridWaitTime + (isLocalDb ? 0 : hybridWaitTime)); // eslint-disable-line no-restricted-syntax
  });

  it('should send proxy request traces to jaeger', async function () {
    let targetDataset: any;
    let urlObj;
    let statusObj;
    let resp = await axios(`${proxyUrl}${paths[0]}`);
    logResponse(resp);
    await wait(jaegerWait + (isLocalDb ? 0 : 10000)); // eslint-disable-line no-restricted-syntax

    resp = await axios(jaegerTracesEndpoint);
    logResponse(resp);
    totalTraces = resp.data.data.length;

    expect(
      resp.data.data.length,
      'Should send one request trace to jaeger'
    ).to.gte(1);

    let isFound = false;
    for (const data of resp.data.data) {
      // find the http.url object which value is 'http://localhost/jaegertest1''
      urlObj = data.spans[0].tags.find((obj) => obj.key === 'http.url');
      logDebug('urlObj.value: ' + urlObj.value);
      statusObj = data.spans[0].tags.find((obj) => obj.key === 'http.status_code');
      logDebug('urlStatus.value: ' + statusObj.value);

      if (urlObj.value.includes(paths[0]) && statusObj.value === 200) {
        isFound = true;
        targetDataset = data;
        break;
      }
    }

    expect(isFound, 'Should find the target trace in jaeger').to.be.true;

    expect(
      targetDataset.spans[0].operationName,
      'Should have operationName kong'
    ).to.equal(`kong`);

    expect(
      targetDataset.processes.p1.serviceName,
      'Should have correct serviceName'
    ).to.equal(`kong`);

    const instance_id = targetDataset.processes.p1.tags.find((obj) => {
      return obj.key === 'service.instance.id';
    });
    const version = targetDataset.processes.p1.tags.find((obj) => {
      return obj.key === 'service.version';
    });
    expect(
      instance_id.value,
      'Should have service.instance.id'
    ).to.be.string;
    expect(
      version.value,
      'Should have service.version'
    ).to.be.string;

    const opelTagUrl = `${proxyUrl.split(':8000')[0]}${paths[0]}`;

    expect(urlObj.value, `Should see correct http.url`).to.equal(opelTagUrl);

    expect(
      targetDataset.spans[0].tags.some((tag) => tag.value === 200),
      `Should see correct status_code in jaeger trace span tags`
    ).to.be.true;
  });

  it('should patch opel plugin resource_attributes', async function () {
    const resp = await axios({
      method: 'patch',
      url: `${url}/${pluginId}`,
      data: {
        config: {
          resource_attributes: {
            'service.instance.id': '8888',
            'service.version': 'kongtest',
          },
        },
      },
    });
    logResponse(resp);

    expect(resp.status, 'Status should be 200').to.equal(200);
    expect(
      resp.data.config.resource_attributes['service.instance.id'],
      'Should see updated instance id'
    ).to.equal('8888');
    expect(
      resp.data.config.resource_attributes['service.version'],
      'Should see updated instance id'
    ).to.equal('kongtest');

    await wait( // eslint-disable-line no-restricted-syntax
      isHybrid
        ? hybridWaitTime + (isLocalDb ? 0 : hybridWaitTime)
        : waitTime + (isLocalDb ? 0 : waitTime)
    );
  });

  it('should send updated service instance.id and version metadata to jaeger', async function () {
    let resp = await axios(`${proxyUrl}${paths[1]}`);
    logResponse(resp);
    await wait(jaegerWait + (isLocalDb ? 0 : hybridWaitTime)); // eslint-disable-line no-restricted-syntax

    resp = await axios(jaegerTracesEndpoint);
    logResponse(resp);

    maxAllowedTraces = totalTraces + 1;

    expect(
      resp.data.data.length,
      'Should see correct number of request traces in jaeger'
    ).to.equal(maxAllowedTraces);

    // setting new totalTraces number
    totalTraces = resp.data.data.length;

    let isFound = false;
    for (const data of resp.data.data) {
      const urlObj = data.spans[0].tags.find((obj) => obj.key === 'http.url');

      if (urlObj.value.includes(paths[1])) {
        isFound = true;

        expect(urlObj.value, `Should see correct http.url`).to.contain(
          paths[1]
        );

        expect(
          data.spans[0].operationName,
          'Should have kong operationName'
        ).to.equal(`kong`);

        const instance_id = data.processes.p1.tags.find((obj) => {
          return obj.key === 'service.instance.id';
        });
        const version = data.processes.p1.tags.find((obj) => {
          return obj.key === 'service.version';
        });
        expect(
          instance_id.value,
          'Should have correct service.instance.id'
        ).to.equal(`8888`);
        expect(
          version.value,
          'Should have correct service.version'
        ).to.equal(`kongtest`);
      }
    }

    expect(isFound, 'Should find the target trace in jaeger').to.be.true;
  });

  it('should not get 500 when traceparent -00 header is present in the request', async function () {
    // note that traces will not be sent as the header has suffix -00
    const resp = await axios({
      url: `${proxyUrl}${paths[1]}`,
      headers: {
        traceparent: '00-fff379b78684fd43a9e2bba4676ddc90-eb1c7f5c7a2f374f-00',
      },
    });

    logResponse(resp);
    expect(resp.status, 'Status should be 200').to.equal(200);
  });

  after(async function () {
    await resetGatewayContainerEnvVariable(
      {
        KONG_TRACING_INSTRUMENTATIONS: 'off',
        KONG_TRACING_SAMPLING_RATE: 0.01,
      },
      gwContainerName
    );
    if (isHybrid) {
      await resetGatewayContainerEnvVariable(
        {
          KONG_TRACING_INSTRUMENTATIONS: 'off',
          KONG_TRACING_SAMPLING_RATE: 0.01,
        },
        'kong-dp1'
      );
    }
    await deletePlugin(pluginId);
    await deleteGatewayRoute(routeId);
    await deleteGatewayService(serviceId);
  });
});
