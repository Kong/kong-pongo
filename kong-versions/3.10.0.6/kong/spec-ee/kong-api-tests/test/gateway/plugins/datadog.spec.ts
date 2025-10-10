/* eslint-disable no-prototype-builtins */
import axios from 'axios';
import {
  expect,
  Environment,
  getBasePath,
  createGatewayService,
  randomString,
  logResponse,
  createRouteForService,
  isGateway,
  waitForConfigRebuild,
  eventually,
  postNegative,
  vars,
  constants,
  createConsumer,
  createPlugin,
  createKeyCredentialForConsumer,
  patchPlugin,
  checkGwVars,
  clearAllKongResources,
  runDockerComposeCommand,
  runCommandInDockerContainer,
  isContainerRunningByName
} from '@support';
import { client, v2 } from "@datadog/datadog-api-client";

xdescribe('Gateway Plugins: Datadog', function () {
  const datadogApiKey = vars.datadog.DATADOG_API_KEY;
  const datadogAppKey = constants.datadog.DATADOG_APPLICATION_KEY;
  const configurationOpts = {
    authMethods: {
      apiKeyAuth: datadogApiKey,
      appKeyAuth: datadogAppKey
    },
  };
  const dataDogConfiguration = client.createConfiguration(configurationOpts);
  const datadogAgentContainerName = 'datadog';
  const datadogAgentPort = 8125;
  const datadogPrefixName = `kong_${Date.now()}`;
  const pluginPayload = {
    "name": "datadog",
    "instance_name": "dd_sdet_instance",
    "config": {
      "consumer_tag": "consumer",
      "host": datadogAgentContainerName,
      "metrics": [
        {
          "consumer_identifier": "custom_id",
          "sample_rate": 1,
          "tags": [
              "app:kong"
          ],
          "stat_type": "counter",
          "name": "request_count"
        }
      ],
      "port": datadogAgentPort,
      "prefix": datadogPrefixName,
      "queue": {
          "concurrency_limit": 1,
          "initial_retry_delay": 0.01,
          "max_batch_size": 1,
          "max_coalescing_delay": 1,
          "max_entries": 10000,
          "max_retry_delay": 60,
          "max_retry_time": 60
      },
      "service_name_tag": "dd_sdet_service_name",
      "status_tag": "status"
    }
  };
  const url = `${getBasePath({
    environment: isGateway() ? Environment.gateway.admin : undefined,
  })}/plugins`;
  const proxyUrl = `${getBasePath({
    app: 'gateway',
    environment: Environment.gateway.proxy,
  })}`;
  const routeTag = "route";
  const routeName = "named_route_1";
  const namedRoutePath = '/namedRoute';
  const unnamedRoutePath = '/unnamedRoute';
  const keyAuthpluginPayload = {
      name: 'key-auth',
      config: { key_names: ["api_key"] },
    };
  const consumerName = "consumer1";
  const consumerCustomId = "consumer_custom_id_1";

  const v2LogsApi = new v2.LogsApi(dataDogConfiguration);
  const v2MetricsApi = new v2.MetricsApi(dataDogConfiguration);

  let serviceId: string;
  let namedRouteId: string;
  let unNamedRouteId: string;
  let datadogPluginId: string;
  let consumerId: string;
  let requestId: string;
  let consumerKey: string;

  before(async function () {
    checkGwVars('datadog');

    // Check if the datadog container is running, if not, start it
    const isDatadogRunning = await isContainerRunningByName(datadogAgentContainerName);

    if(!isDatadogRunning) {
      const command = `--profile manual up -d ${datadogAgentContainerName}`; // Start datadog container
      runDockerComposeCommand(command);

      // Wait for datadog container to be healthy
      await eventually(async () => {
        const containerStatus = runCommandInDockerContainer(datadogAgentContainerName, "agent health");
        expect(containerStatus, 'Should datadog agent be healthy').to.contain("Agent health: PASS");
      });
    }

    const service = await createGatewayService(randomString());
    serviceId = service.id;
    const unnamedRoute = await createRouteForService(serviceId, [unnamedRoutePath], { name: null, protocols:["http"] });
    unNamedRouteId = unnamedRoute.id;
    const namedRoute = await createRouteForService(serviceId, [namedRoutePath], { name: routeName, protocols:["http"] });
    namedRouteId = namedRoute.id;
    await createPlugin(keyAuthpluginPayload);
    const consumer = await createConsumer(consumerName, { 
      custom_id: consumerCustomId
    })
    consumerId = consumer.id;
    const consumerKeyReq = await createKeyCredentialForConsumer(consumerId, 'key-auth', { 'key': 'top-secret-key' });
    consumerKey = consumerKeyReq.key;
  });

  it('should not create datadog plugin with a metric missing name', async function () {
    const incompletePayload = {
      "name": "datadog",
      "instance_name": "dd_sdet_instance",
      "config": {
          "consumer_tag": "consumer",
          "host": datadogAgentContainerName,
          "metrics": [
              {
                  "tags": [
                      "app:kong"
                  ],
                  "consumer_identifier": "custom_id",
                  "sample_rate": 1,
                  "stat_type": "counter"
              }
          ],
          "port": datadogAgentPort
      }
    };

    const resp = await postNegative(url, incompletePayload, 'POST');

    logResponse(resp);

    expect(resp.status, 'Status should be 400').to.equal(400);
    expect(resp.data.message, 'Should have correct error message').to.contain('name = "required field missing"')
  });

  it('should not create datadog plugin with a metric missing stat_type', async function () {
    const incompletePayload = {
      "name": "datadog",
      "instance_name": "dd_sdet_instance",
      "config": {
          "consumer_tag": "consumer",
          "host": datadogAgentContainerName,
          "metrics": [
            {
              "tags": [
                  "app:kong"
              ],
              "name": "request_count",
              "consumer_identifier": "custom_id",
              "sample_rate": 1
            }
          ],
          "port": datadogAgentPort
      }
    };

    const resp = await postNegative(url, incompletePayload, 'POST');

    logResponse(resp);

    expect(resp.status, 'Status should be 400').to.equal(400);
    expect(resp.data.message, 'Should have correct error message').to.contain('stat_type = "field required for entity check"')
  });

  it('should not create datadog plugin with invalid sample_rate in a metric', async function () {
    const incompletePayload = {
      "name": "datadog",
      "instance_name": "dd_sdet_instance",
      "config": {
        "consumer_tag": "consumer",
        "host": datadogAgentContainerName,
        "metrics": [
          {
            "tags": [
                "app:kong"
            ],
            "name": "request_count",
            "consumer_identifier": "consumer_id",
            "sample_rate": -1,
            "stat_type": "counter"
          }
        ],
        "port": datadogAgentPort
      }
    };

    const resp = await postNegative(url, incompletePayload, 'POST');

    logResponse(resp);

    expect(resp.status, 'Status should be 400').to.equal(400);
    expect(resp.data.message, 'Should have correct error message').to.contain("failed conditional validation given value of field 'stat_type'")
    expect(resp.data.message, 'Should have correct error message').to.contain('sample_rate = "value should be between 0 and 1"')
  });

  it('should create datadog plugin with a valid payload', async function () {
    const resp = await axios({
      method: 'post',
      url,
      data: pluginPayload,
    });

    logResponse(resp);

    datadogPluginId = resp.data.id;
    expect(resp.status, 'Status should be 201').to.equal(201);
    expect(resp.data.config.host, 'Should have correct host').to.equal(datadogAgentContainerName);
    expect(resp.data.config.port, 'Should have correct port').to.equal(datadogAgentPort);
    expect(resp.data.config.prefix, 'Should have correct prefix').to.equal(datadogPrefixName);
    expect(resp.data.config.service_name_tag, 'Should have correct service_name_tag').to.equal(pluginPayload.config.service_name_tag);
    expect(resp.data.config.metrics[0], 'Should have correct metrics').to.eql(pluginPayload.config.metrics[0]);

    await waitForConfigRebuild()
  });

  it('should log events be pushed to datadog server via datadog agent', async function () {
    /*
    * See datadog api reference page: https://docs.datadoghq.com/api/latest/logs/#search-logs-get
    *
    * A request is made with datadog client to retrieved event logs being pushed from kong via datadog
    * agent to datadog server. A query param is passed using the proxy kong request_id to ensure we
    * are pushing logs events in real time
    */ 

    // proxy request
    const resp = await axios({
      url: `${proxyUrl}${unnamedRoutePath}`,
      headers: { ['api_key']: consumerKey }
    });

    // verify the responses
    logResponse(resp);
    expect(resp.status, 'Status should be 200').to.equal(200);

    // save request_id
    requestId = resp.headers['x-kong-request-id']
    
    const logsApiListLogsGetRequest = {
      filterQuery: requestId
    };
    
    await eventually(async () => {
      const dataDogLogs = await v2LogsApi.listLogsGet(logsApiListLogsGetRequest);
      expect(dataDogLogs.data?.length, 'log event should be present in datadog server').greaterThan(0);
      if (dataDogLogs.data) {
        expect(dataDogLogs.data[0].attributes?.message, "route path is present in event log").to.include(`GET ${unnamedRoutePath} HTTP/1.1`);
        expect(dataDogLogs.data[0].attributes?.message, `kong_request_id ${requestId} is present in event log`).to.include(`kong_request_id: "${requestId}"`);
      }
    });
  });

  it('should push metrics events to datadog server via datadog agent', async function () {
    /*
    * See datadog api reference page: https://docs.datadoghq.com/api/latest/metrics/#query-timeseries-data-across-multiple-products
    *
    * A request is made with datadog client to retrieved metrics being pushed from kong via datadog
    * agent to datadog server. Proxy requests are triggered and then we query datadog metrix explorer
    * to see how matrix histogram changes from zero to a non-zero value. 
    */ 

    const params: v2.MetricsApiQueryTimeseriesDataRequest = {
      body: {
        data: {
          type: "timeseries_request",
          attributes: {
            queries: [
              {
                dataSource: "metrics",
                name: "query1",
                query: `avg:${datadogPrefixName}.request.count{*}.as_count()`
              }
            ],
            from: Date.now() - (10000),
            to: Date.now() + (1200000),
            interval: 20000,
            additionalProperties: {
              minimum_interval: 5000
            },
            formulas: [
              {
                formula: "query1"
              }
            ]
          }
        }
      },
    };
    
    await eventually(async () => {
      // proxy request
      const resp = await axios({
        url: `${proxyUrl}${unnamedRoutePath}`,
        headers: { ['api_key']: consumerKey }
      });

      // verify the responses
      expect(resp.status, 'Status should be 200').to.equal(200);
      
      const dataDogLogs = await v2MetricsApi.queryTimeseriesData(params);
      // dataValues: Is an array of values for metric requested
      const dataValues = dataDogLogs.data?.attributes?.values;
      // validate that there are values greater than zero. This means that kong has sent increments for that 
      // metric due to requests being sent to the proxy url
      expect(dataValues?.length ? dataValues[0][dataValues[0].length - 1] : 0, 'metrics values should be greather than zero for the last time series').greaterThan(0);
    });
  });

  describe('metrics with consumer identifier', function () {
    const consumerIdentifiers = ["custom_id", "consumer_id"];
    const getConsumerIdentifierValue = (consumerIdentifier: string) => {
      let identifierValue = "";
      switch (consumerIdentifier) {
        case "custom_id": identifierValue = consumerCustomId; break;
        case "consumer_id": identifierValue = consumerId.split("-").join("_"); break;
      }
      return `consumer:${identifierValue}`;
    }

    for (const consumerIdentifier of consumerIdentifiers) {
      it(`should metrics events be pushed with consumer identifier equal to ${consumerIdentifier}`, async function () {
        // patch datadog plugin and make sure metrics are using the right consumer identifier
        const patchPayload = pluginPayload;
        patchPayload.config.metrics[0].consumer_identifier = consumerIdentifier;
        await patchPlugin(datadogPluginId, patchPayload);
       
        /*
        * See datadog api reference page: https://docs.datadoghq.com/api/latest/metrics/#query-timeseries-data-across-multiple-products
        *
        * A request is made with datadog client to retrieved metrics being pushed from kong via datadog
        * agent to datadog server. Proxy requests are triggered and then we query datadog metrix explorer
        * to see how matrix histogram changes from zero to a non-zero value. 
        * 
        * For the case we want to group metrics by consumer custom_id or consumer_id extra filters are
        * added to the query.
        * 
        */
        
        const params: v2.MetricsApiQueryTimeseriesDataRequest = {
          body: {
            data: {
              type: "timeseries_request",
              attributes: {
                queries: [
                  {
                    dataSource: "metrics",
                    name: "query1",
                    query: `avg:${datadogPrefixName}.request.count{*} by {consumer}.as_count()`
                  }
                ],
                from: Date.now() - (20000),
                to: Date.now() + (1200000),
                interval: 20000,
                additionalProperties: {
                  minimum_interval: 5000
                },
                formulas: [
                  {
                    formula: "query1"
                  }
                ]
              }
            }
          },
        };
        
        await eventually(async () => {
          // proxy request
          const resp = await axios({
            url: `${proxyUrl}${unnamedRoutePath}`,
            headers: { ['api_key']: consumerKey }
          });
  
          // verify the responses
          expect(resp.status, 'Status should be 200').to.equal(200);
          
          // retrieve metrics from datadog server
          const dataDogLogs = await v2MetricsApi.queryTimeseriesData(params);

          /* 
          * Validate that metrics with the right consumer identifier start appearing with the pass of time.
          * It would take a couple of seconds for new metrics being pushed from kong reach datadog server.
          * It could be that new consumer identifier is reported ("groupTag" attribute) but with zero values
          * so an extra expect was added to ensure metrics has a non-zero value
          */

          // dataSeries: represent an array of metric grouped by tag/name/filter
          const dataSeries = dataDogLogs.data?.attributes?.series;
          // dataValues: Is an array of values for each group of metric group and a time interval
          const dataValues = dataDogLogs.data?.attributes?.values;

          // check that response has metric groups 
          expect(dataSeries?.length, 'metrics series should be greather than zero representing we have consumer custom_id data points').greaterThan(0);
          if (dataSeries?.length) {
            // If there are metric groups validate that our consumer identifier tag is present 
            const groupTags = dataSeries.map(elem => elem.groupTags?.length ? elem.groupTags[0] : undefined);
            expect(groupTags).to.includes(getConsumerIdentifierValue(consumerIdentifier));

            // If the metric identifier group is present validate that there are values greater than zero. This means
            // that kong has sent increments for that metric group due to requests being sent to the proxy url
            const valuesIndex = dataSeries.findIndex(elem =>  elem.groupTags?.includes(getConsumerIdentifierValue(consumerIdentifier)));
            expect(dataValues?.length ? dataValues[valuesIndex][dataValues[valuesIndex].length - 1] : 0, 'metrics values should be greather than zero for the last time series').greaterThan(0);
          }
        });
      });
    }
  });

  /*
   * These tests are added to cover changes introduced in https://github.com/Kong/kong-ee/pull/12379 
   * They need to be skipped until changes are mergeed into master. Tests can still be run locally using
   * the dev  image: kong/kong-gateway-dev:ddf600ef7ab699cad832a8315fa242555eb4eeb1-ubuntu
   */
  describe.skip('metrics with route identifier', function(){
    const routeIdentifiers = ["route_name", "route_id"];
    for (const routeIdentifier of routeIdentifiers) {
      it(`should metrics events be pushed with route identifier equal to "${routeIdentifier}"`, async function () {
        // patch datadog plugin to only run for the specific route path created above
        const patchPayload = pluginPayload;
        patchPayload["route"] = { id: routeIdentifier === "route_name" ? namedRouteId : unNamedRouteId };
        patchPayload.config["route_name_tag"] = routeTag;

        await patchPlugin(datadogPluginId, patchPayload);
        
        /*
        * See datadog api reference page: https://docs.datadoghq.com/api/latest/metrics/#query-timeseries-data-across-multiple-products
        *
        * A request is made with datadog client to retrieved metrics being pushed from kong via datadog
        * agent to datadog server. Proxy requests are triggered and then we query datadog metrix explorer
        * to see how matrix histogram changes from zero to a non-zero value. 
        * 
        * For the case we want to group metrics by consumer custom_id or consumer_id extra filters are
        * added to the query.
        * 
        */
        
        const params: v2.MetricsApiQueryTimeseriesDataRequest = {
          body: {
            data: {
              type: "timeseries_request",
              attributes: {
                queries: [
                  {
                    dataSource: "metrics",
                    name: "query1",
                    query: `avg:${datadogPrefixName}.request.count{*} by {route}.as_count()`
                  }
                ],
                from: Date.now() - (20000),
                to: Date.now() + (1200000),
                interval: 20000,
                additionalProperties: {
                  minimum_interval: 5000
                },
                formulas: [
                  {
                    formula: "query1"
                  }
                ]
              }
            }
          },
        };
        
        await eventually(async () => {
          // proxy request to the specific route path
          const resp = await axios({
            url: `${proxyUrl}${routeIdentifier === "route_name" ? namedRoutePath : unnamedRoutePath }`,
            headers: { ['api_key']: consumerKey }
          });

          // verify the responses
          expect(resp.status, 'Status should be 200').to.equal(200);
          
          // retrieve metrics from datadog server
          const dataDogLogs = await v2MetricsApi.queryTimeseriesData(params);

          /* 
          * Validate that metrics with the right route identifier start appearing with the pass of time.
          * It would take a couple of seconds for new metrics being pushed from kong reach datadog server.
          * It could be that the new route identifier is reported ("groupTag" attribute) but with zero values
          * so an extra assert was added in order to ensure metrics has a non-zero value
          */

          // dataSeries: represent an array of metric grouped by tag/name/filter
          const dataSeries = dataDogLogs.data?.attributes?.series;
          // dataValues: Is an array of values for each group of metric group and a time interval
          const dataValues = dataDogLogs.data?.attributes?.values;

          // check that response has metric groups 
          expect(dataSeries?.length, 'metrics series should be greather than zero representing we have consumer custom_id data points').greaterThan(0);
          if (dataSeries?.length) {
            // If there are metric groups validate that our consumer identifier tag is present 
            const groupTags = dataSeries.map(elem => elem.groupTags?.length ? elem.groupTags[0] : undefined);
            expect(groupTags).to.includes(`route:${routeIdentifier === "route_name" ? routeName : unNamedRouteId}`);

            // If the metric identifier group is present validate that there are values greater than zero. This means
            // that kong has sent increments for that metric group due to requests being sent to the proxy url
            const valuesIndex = dataSeries.findIndex(elem =>  elem.groupTags?.includes(`route:${routeIdentifier === "route_name" ? routeName : unNamedRouteId}`));
            expect(dataValues?.length ? dataValues[valuesIndex][dataValues[valuesIndex].length - 1] : 0, 'metrics values should be greather than zero for the last time series').greaterThan(0);
          }
        });
      });
    }    
  });

  after(async function () {
    runDockerComposeCommand('rm -sf datadog'); // Stop datadog container
    await clearAllKongResources();
  });
});
