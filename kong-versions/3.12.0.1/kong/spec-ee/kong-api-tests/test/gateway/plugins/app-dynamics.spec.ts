import axios from 'axios';
import {
  createGatewayService,
  createRouteForService,
  Environment,
  expect,
  getBasePath,
  logResponse,
  waitForConfigRebuild,
  isGateway,
  clearAllKongResources,
  randomString,
  wait,
  checkGwVars,
  checkForArm64,
  createPolly,
  eventually
} from '@support'
import { waitForAppDService } from 'support/utilities/metrics';


(checkForArm64() ? describe.skip : describe)('Gateway Plugins: AppDynamics', function () {
  let serviceName = randomString()

  const routeName = 'appD-route'
  const routePath = '/app-dynamics'
  const appName = 'SDET'

  let serviceId: string
  let routeId: string
  let pluginId: string
  let url: string
  let proxyUrl: string
  let pluginPayload: object
  let polly: any

  const sendRequestsAndReturnLastResp = async function (numRequests) {
    let resp
    for (let i = 0; i < numRequests; i++) {
      // eslint-disable-next-line no-restricted-syntax
      await wait(2000)
      resp = await axios({
        method: 'get',
        url: `${proxyUrl}${routePath}`,
        validateStatus: null,
      });
      logResponse(resp)
    }
    expect(resp.status, 'Status should be 200').to.equal(200)
    return resp
  }

  before(async function () {
    checkGwVars('app_dynamics')

    url = `${getBasePath({
      environment: isGateway() ? Environment.gateway.admin : undefined,
    })}`;
    proxyUrl = `${getBasePath({
      app: 'gateway',
      environment: Environment.gateway.proxy,
    })}`;

    const service = await createGatewayService(serviceName)
    serviceId = service.id
    serviceName = service.name
    const route = await createRouteForService(serviceId, [routePath], { name: routeName})
    routeId = route.id 

    pluginPayload = {
      name: 'app-dynamics', 
      service: {
        id: serviceId,
      },
      route: {
        id: routeId,
      }, 
    }
  });

  it('should create the app-dynamics plugin successfully', async function () {
    const resp = await axios({
      method: 'post',
      url: `${url}/plugins`,
      data: pluginPayload,
      validateStatus: null,
    });
    logResponse(resp)
    expect(resp.status, 'Status should be 201').to.equal(201)
    pluginId = resp.data.id

    await waitForConfigRebuild()
  });

  it('should send request and see the Singularityheader when AppDynamics plugin is enabled', async function () {
    // send 5 requests
    polly = createPolly('appdynamics')
    polly.configure({matchRequestsBy: { headers: false, url: { hostname: true, pathname: false, query: false, hash: false }}})

    const resp = await sendRequestsAndReturnLastResp(5)

    expect(resp.data.headers.Singularityheader, 'Should see the Singularityheader').to.contain('appId')
  });

  it('should see app-dynamics service in appdynamics', async function () {
    await eventually(async () => {
      await waitForAppDService(serviceName, appName)
    });
    console.log('WaitforAppDService returned')
  });

  it('should be able to access app-dynamics metrics', async function () {
    await polly.play()
    await eventually(async () => {
      const resp = await waitForAppDService(serviceName, appName)
      
      expect(resp.data, `Should receive AppDynamics query results for Average Response Time`).to.not.be.empty
      expect(resp.data[0].metricName, 'Should see correct metric name').to.contain('Average Response Time (ms)')
      expect(resp.data[0].metricValues, 'Should see expected metric values').to.not.be.empty
      expect(resp.data[0].metricValues[0].count, 'Should see expected metric values').to.be.gte(1)
    });
  });

  it('should delete the app-dynamics plugin', async function () {
    await polly.stop()
    const resp = await axios({
      method: 'delete',
      url: `${url}/plugins/${pluginId}`,
    })
    logResponse(resp)

    expect(resp.status, 'Status should be 204').to.equal(204)

    await waitForConfigRebuild()
  })

  it('should send request and no longer see SingularityHeader', async function () {
    const resp = await axios({
      method: 'get',
      url: `${proxyUrl}${routePath}`,
      validateStatus: null,
    })
    logResponse(resp)

    expect(resp.status, 'Status should be 200').to.equal(200)
    expect(resp.data.headers.Singularityheader, 'Should not see the Singularityheader').to.not.exist
  })

  after(async function () {
    await clearAllKongResources()
  })
})
