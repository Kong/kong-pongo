import axios from 'axios';
import {
  expect,
  Environment,
  getBasePath,
  postNegative,
  createGatewayService,
  updateGatewayService,
  createRouteForService,
  getGatewayContainerLogs,
  randomString,
  logResponse,
  eventually,
  waitForConfigRebuild,
  isGateway,
  createConsumer,
  createPlugin,
  deletePlugin,
  createKeyCredentialForConsumer,
  findRegex,
  isGwHybrid,
  getKongContainerName,
  resetGatewayContainerEnvVariable,
  clearAllKongResources
} from '@support';


describe('@smoke: Gateway Plugins: exit-transformer', function () {
  const path = `/${randomString()}`;
  const statusInFunctions = 500;
  const headersInFunctions = { "name": "x-some-header", "value": "some value" };
  const consumerName = 'luka';
  const kongContainerName = isGwHybrid() ? 'kong-dp1' : getKongContainerName();

  let serviceId: string;
  let routeId: string;
  let pluginId: string;
  let basePayload: any;
  let keyAuth_pluginId: string;
  let basicAuth_pluginId: string;
  let proxyCacheAdvanced_pluginId: string;
  let consumerId: string;

  const url = `${getBasePath({
    environment: isGateway() ? Environment.gateway.admin : undefined,
  })}/plugins`;
  const proxyUrl = `${getBasePath({
    app: 'gateway',
    environment: Environment.gateway.proxy,
  })}`;


  before(async function () {
    await resetGatewayContainerEnvVariable(
      {
        KONG_UNTRUSTED_LUA: 'on'
      },
      getKongContainerName()
    );
    if (isGwHybrid()) {
      await resetGatewayContainerEnvVariable(
        {
          KONG_UNTRUSTED_LUA: 'on'
        },
        'kong-dp1'
      );
    }

    const service = await createGatewayService(randomString());
    serviceId = service.id;
    const route = await createRouteForService(serviceId, [path]);
    routeId = route.id;
    const consumer = await createConsumer(consumerName);
    consumerId = consumer.id;

    basePayload = {
      name: 'exit-transformer',
      service: {
        id: serviceId,
      }
    };
  });


  it('should fail to create an exit-transformer plugin: without functions', async function () {
    const resp = await postNegative(url, basePayload);
    logResponse(resp);

    expect(resp.status, 'Status should be 400').to.equal(400);
    expect(resp.data.message, 'Should have correct error message').to.contain(
      `schema violation (config.functions: required field missing)`
    );
  });

  it('should create an exit-transformer plugin scoped to a service', async function () {
    const luaFunctions = `
    return function(status, body, headers)
      headers = { ["${headersInFunctions.name}"] = "${headersInFunctions.value}" }
      local new_body = {
        error = true,
        message = "Status: " .. status .. ", Body: " .. body.message,
      }
      kong.log("test kong.log - 12345678")  
      return ${statusInFunctions}, new_body, headers
    end
  `;

    const pluginPayload = {
      ...basePayload,
      config: {
        functions: [luaFunctions.trim()]
      },
    };

    const normalize = (str: string) => str.trim().replace(/\s+/g, " ").replace(/"\[/g, "[").replace(/\]"/g, "]");

    const resp = await axios({ method: 'post', url, data: pluginPayload });
    logResponse(resp);
    expect(resp.status, 'Status should be 201').to.equal(201);
    expect(
      normalize(resp.data.config.functions[0]),
      'Should have correct config.functions'
    ).to.eq(normalize(luaFunctions));
    expect(
      resp.data.service.id,
      'Service id should not be null'
    ).to.not.equal(null);
    expect(
      resp.data.config.handle_unexpected,
      'Should have correct config.handle_unexpected'
    ).to.eq(false);
    expect(
      resp.data.config.handle_unknown,
      'Should have correct config.handle_unknown'
    ).to.eq(false)
    pluginId = resp.data.id;
    await waitForConfigRebuild()
  });

  it('create a key-auth plugin and create credentials for consumers', async function () {
    //Create a key-auth plugin
    const pluginPayload = {
      name: "key-auth",
      config: { "key_names": ["apikey"] }
    };
    const keyAuthPlugin = await createPlugin(pluginPayload);
    keyAuth_pluginId = keyAuthPlugin.id;

    //Create credentials
    await createKeyCredentialForConsumer(consumerId, 'key-auth', { 'key': 'top-secret-key' });
  });

  it('should handle responses(status code 401) when scoped to a service', async function () {
    await eventually(async () => {
      const resp = await axios({
        url: `${proxyUrl}${path}`,
        validateStatus: null,
        headers: {
          'apikey': 'invalid-key',
        }
      });
      //Verify the logs(https://konghq.atlassian.net/browse/FTI-2358) 
      const currentLogs = getGatewayContainerLogs(kongContainerName, 30);
      const isLogFound = findRegex(`test kong.log - 12345678`, currentLogs);
      expect(
        isLogFound,
        'Should see logs for the test case'
      ).to.be.true;

      //Verify the responses
      logResponse(resp);
      expect(resp.status, `Status should be ${statusInFunctions}`).to.equal(statusInFunctions);
      expect(resp.data.message, 'Body.message should be correct').to.equal('Status: 401, Body: Unauthorized');
      expect(resp.headers[`${headersInFunctions.name}`], `Headers should include ${headersInFunctions.name}:${headersInFunctions.value}`).to.equal(headersInFunctions.value)
    })
  });

  //Note: The case is added because the plugin only handle these responses: 4xx and 5xx
  it('should not handle responses(status code 200)', async function () {
    await eventually(async () => {
      const resp = await axios({
        url: `${proxyUrl}${path}`,
        validateStatus: null,
        headers: {
          'apikey': 'top-secret-key'
        }
      });
      logResponse(resp);
      expect(resp.status, `Status should be 200`).to.equal(200);
      expect(resp.data, `Body should not include message`).to.not.have.property('message');
      expect(resp.headers, `Headers should not include ${headersInFunctions.name}`).to.not.have.property(headersInFunctions.name);
    })
  });

  it('should disable the plugin ', async function () {
    const resp1 = await axios({
      method: 'patch',
      url: `${url}/${pluginId}`,
      data: {
        "enabled": false
      },
    });
    logResponse(resp1);
    expect(resp1.status, `Status should be 200`).to.equal(200);
  })

  it('should not handle responses(status code 401) after disabling the plugin', async function () {
    await eventually(async () => {
      const resp = await axios({
        url: `${proxyUrl}${path}`,
        validateStatus: null
      });
      logResponse(resp);
      expect(resp.status, `Status should be 401`).to.equal(401);
      expect(resp.data.message, 'Body.message should be correct').to.equal("No API key found in request");
      expect(resp.headers, `Headers should not include ${headersInFunctions.name}`).to.not.have.property(headersInFunctions.name);
    })
  });

  //Creating a basic-auth plugin to prepare test environment for https://konghq.atlassian.net/browse/FTI-5804
  it('create a basic-auth plugin', async function () {
    const pluginPayload = {
      name: "basic-auth"
    };
    const basicAuth_resp = await createPlugin(pluginPayload);
    basicAuth_pluginId = basicAuth_resp.id;
  });

  it('should patch "route" of the exit-transformer plugin to a valid route id ', async function () {
    const resp1 = await axios({
      method: 'patch',
      url: `${url}/${pluginId}`,
      data: {
        "enabled": true,
        "service": null,
        "route": {
          "id": routeId
        }
      },
    });
    logResponse(resp1);
    expect(resp1.status, `Status should be 200`).to.equal(200);
  })

  //Case related to the closed issue: https://konghq.atlassian.net/browse/FTI-5804
  it('should handle responses(status code 401) when scoped to a route and using 2 auth plugins', async function () {
    await eventually(async () => {
      const resp = await axios({
        url: `${proxyUrl}${path}`,
        headers: {
          'apikey': 'top-secret-key',
        },
        validateStatus: null
      });
      logResponse(resp);
      expect(resp.status, `Status should be ${statusInFunctions}`).to.equal(statusInFunctions);
      expect(resp.data.message, 'Body.message should be correct').to.equal("Status: 401, Body: Unauthorized");
      expect(resp.headers[`${headersInFunctions.name}`], `Headers should include ${headersInFunctions.name}:${headersInFunctions.value}`).to.equal(headersInFunctions.value)
    })
  });

  it('should patch "consumer" of the exit-transformer plugin to a valid consumer id', async function () {
    const resp1 = await axios({
      method: 'patch',
      url: `${url}/${pluginId}`,
      data: {
        "enabled": true,
        "service": null,
        "route": null,
        "consumer": {
          "id": consumerId
        }
      },
    });
    logResponse(resp1);
    expect(resp1.status, `Status should be 200`).to.equal(200);
  })

  //Case related to the closed issue(Unresolved because of design): https://konghq.atlassian.net/browse/FTI-5804
  it('should fail to handle responses(status code 401) when scoped to a consumer and using 2 auth plugins', async function () {
    await eventually(async () => {
      const resp = await axios({
        url: `${proxyUrl}${path}`,
        headers: {
          'apikey': 'top-secret-key',
        },
        validateStatus: null
      });
      logResponse(resp);
      expect(resp.status, `Status should be 401`).to.equal(401);
      expect(resp.data.message, 'Body.message should be correct').to.equal("Unauthorized");
      expect(resp.headers, `Headers should not include ${headersInFunctions.name}`).to.not.have.property(headersInFunctions.name);
    })
  });

  it('delete a basic-auth plugin', async function () {
    await deletePlugin(basicAuth_pluginId);
  });

  //Creating a proxy-cache-advanced plugin to simulate a 5xx error for testing purposes
  it('create proxy-cache-advanced plugin', async function () {
    const pluginPayload = {
      "name": "proxy-cache-advanced",
      "config": {
        "strategy": "redis"
      }
    };
    const proxyCacheAdvancedPlugin = await createPlugin(pluginPayload);
    proxyCacheAdvanced_pluginId = proxyCacheAdvancedPlugin.id;
  });

  //Known limitation: Exit-Transformer plugin does not fire when scoped to a consumer
  it('should not handle responses(status code 502) when scoped to a consumer and using key-auth plugin only', async function () {
    await eventually(async () => {
      const resp = await axios({
        url: `${proxyUrl}${path}`,
        headers: {
          'apikey': 'top-secret-key',
        },
        validateStatus: null
      });
      logResponse(resp);
      expect(resp.status, `Status should be 502`).to.equal(502);
      expect(resp.data.message, 'Body.message should be correct').to.equal("connection refused");
      expect(resp.headers, `Headers should not include ${headersInFunctions.name}`).to.not.have.property(headersInFunctions.name);
    })
  });

  it('should patch "service", "route" and "consumer" of the exit-transformer plugin to null', async function () {
    const resp1 = await axios({
      method: 'patch',
      url: `${url}/${pluginId}`,
      data: {
        "service": null,
        "route": null,
        "consumer": null
      }
    });
    logResponse(resp1);
    expect(resp1.status, `Status should be 200`).to.equal(200);
  })

  it('should handle responses(status code 502) when it is global', async function () {
    await eventually(async () => {
      const resp = await axios({
        url: `${proxyUrl}${path}`,
        validateStatus: null,
        headers: {
          'apikey': 'top-secret-key',
        }
      });
      logResponse(resp);
      expect(resp.status, `Status should be ${statusInFunctions}`).to.equal(statusInFunctions);
      expect(resp.data.message, 'Body.message should be correct').to.equal("Status: 502, Body: connection refused");
      expect(resp.headers[`${headersInFunctions.name}`], `Headers should include ${headersInFunctions.name}:${headersInFunctions.value}`).to.equal(headersInFunctions.value)
    })
  });

  it('delete a proxy-cache-advanced plugin', async function () {
    await deletePlugin(proxyCacheAdvanced_pluginId);
  });

  it('should patch "functions" of the exit-transformer plugin to a function support html and json', async function () {
    const luaFunctions = `
    local template = require "resty.template"
    local split = require "kong.tools.utils".split

    local HTTP_MESSAGES = {
        s400 = "Bad request",
        s401 = "Unauthorized",
        -- ...
        -- See HTTP Response Status Codes section above for the full list
        s511 = "Network authentication required",
        default = "The upstream server responded with %d"
    }

    local function get_message(status)
        return HTTP_MESSAGES["s" .. status] or string.format(HTTP_MESSAGES.default, status)
    end

    local html = template.compile([[
    <!doctype html>
    <html>
     <head>
       <meta charset="utf-8">
       <title>Some Title</title>
     </head>
     <body>
       <h1>HTTP {{status}}</h1>
       <p>{{error}}</p>
       <img src="https://thumbs.gfycat.com/RegularJointEwe-size_restricted.gif"/>
     </body>
    </html>
    ]])

    -- Customize responses based on content type
    local formats = {
        ["application/json"] = function(status, message, headers)
            return status, { status = status, error = message }, headers
        end,
        ["text/html"] = function(status, message, headers)
            return status, html { status = status, error = message }, headers
        end,
    }

    return function(status, body, headers)
        if status < 400 then
            return status, body, headers
        end

        local accept = kong.request.get_header("accept")
        -- Gets just first accept value. Can be improved to be compliant quality
        -- etc parser. Look into kong.pdk.response get_response_type
        if type(accept) == "table" then
            accept = accept[1]
        end
        accept = split(accept, ",")[1]

        if not formats[accept] then
            return status, body, headers
        end

        return formats[accept](status, get_message(status), headers)
    end
  `;

    const pluginPayload = {
      config: {
        functions: [luaFunctions.trim()]
      }
    };
    await eventually(async () => {
    const resp = await axios({ method: 'patch', url: `${url}/${pluginId}`, data: pluginPayload });
    logResponse(resp);
    })
  })

  it('should customize error response by MIME type - application/json and text/html', async function () {
    //Request the service to verify exit-transformer works for application/json
    await eventually(async () => {
      const resp = await axios({
        url: `${proxyUrl}${path}`,
        validateStatus: null,
        headers: {
          'Accept': 'application/json',
        }
      });
      logResponse(resp);

      expect(resp.status, `Status should be 401`).to.equal(401);
      expect(resp.data.error, 'Body.message should be correct').to.equal("Unauthorized");
    });

    //Request the service to verify exit-transformer works for text/html
    await eventually(async () => {
      const resp = await axios({
        url: `${proxyUrl}${path}`,
        validateStatus: null,
        headers: {
          'Accept': 'text/html',
        }
      });
      logResponse(resp);

      expect(resp.status, `Status should be 401`).to.equal(401);
      expect(resp.data, 'Body should include <h1>HTTP 401</h1>').to.contain(`<h1>HTTP 401</h1>`);
      expect(resp.data, 'Body should include <p>Unauthorized</p>').to.contain(`<p>Unauthorized</p>`);
    });
  })

  it('delete a key-auth plugin ', async function () {
    await deletePlugin(keyAuth_pluginId);
  });

  it('should patch "functions" of the exit-transformer plugin to another valid function', async function () {
    const luaFunctions = `
    return function(status, body, headers)
      headers = { ["${headersInFunctions.name}"] = "${headersInFunctions.value}" }
      local new_body = {
        error = true,
        message = "Status: " .. status .. ", Body: " .. body.message,
      }
      return ${statusInFunctions}, new_body, headers
    end
  `;
    const pluginPayload = {
      config: {
        functions: [luaFunctions.trim()]
      }
    };
    const resp = await axios({ method: 'patch', url: `${url}/${pluginId}`, data: pluginPayload });
    logResponse(resp);
  })

  it('should not handle unknown responses(status code 404) when handle_unknown is not configured', async function () {
    await eventually(async () => {
      const resp = await axios({
        url: `${proxyUrl}/123456`,
        validateStatus: null
      });
      logResponse(resp);
      expect(resp.status, `Status should be 404`).to.equal(404);
      expect(resp.data.message, 'Body.message should be correct').to.equal("no Route matched with those values");
      expect(resp.headers, `Headers should not include ${headersInFunctions.name}`).to.not.have.property(headersInFunctions.name);
    })
  });

  it('should patch "handle_unknown" of the exit-transformer plugin to "true"', async function () {
    const resp1 = await axios({
      method: 'patch',
      url: `${url}/${pluginId}`,
      data: {
        config: {
          handle_unknown: true
        }
      }
    });
    logResponse(resp1);
    expect(resp1.status, `Status should be 200`).to.equal(200);
  })

  it('should handle unknown responses(status code 404) when handle_unknown is true', async function () {
    await eventually(async () => {
      const resp = await axios({
        url: `${proxyUrl}/123456`,
        validateStatus: null
      });
      logResponse(resp);
      expect(resp.status, `Status should be ${statusInFunctions}`).to.equal(statusInFunctions);
      expect(resp.data.message, 'Body.message should be correct').to.equal("Status: 404, Body: no Route matched with those values");
      expect(resp.headers[`${headersInFunctions.name}`], `Headers should include ${headersInFunctions.name}:${headersInFunctions.value}`).to.equal(headersInFunctions.value)
    })
  });

  it('should patch "handle_unknown" and "handle_unexpected" of the exit-transformer plugin to "true"', async function () {
    const resp1 = await axios({
      method: 'patch',
      url: `${url}/${pluginId}`,
      data: {
        config: {
          handle_unknown: true,
          handle_unexpected: true
        }
      }
    });
    logResponse(resp1);
    expect(resp1.status, `Status should be 200`).to.equal(200);
  })

  //https://konghq.atlassian.net/browse/FTI-6344 (Note: According to the Dev, we need set both environment variables to be true to handle this case)
  it('should handle unexpected responses(status code 400) when requests have oversized header/cookie', async function () {
    const longCookie = 'x'.repeat(70000);
    await eventually(async () => {
      const resp = await axios({
        url: `${proxyUrl}${path}`,
        headers: {
          'Cookie': `test=${longCookie}`
        },
        validateStatus: null
      });
      logResponse(resp);
      expect(resp.status, `Status should be ${statusInFunctions}`).to.equal(statusInFunctions);
      expect(resp.data.message, 'Body.message should be correct').to.equal("Status: 400, Body: Request header or cookie too large");
      expect(resp.headers[`${headersInFunctions.name}`], `Headers should include ${headersInFunctions.name}:${headersInFunctions.value}`).to.equal(headersInFunctions.value)
    })
  })

  //Note: The case is added because the plugin does not handle responses from upstream
  it('should not handle responses(status code 401) from upstream service', async function () {
    const serviceResp = await updateGatewayService(serviceId, { url: 'http://httpbin/status/401' })
    expect(serviceResp.id, 'Service id should match').to.equal(serviceId);

    await eventually(async () => {
      const resp = await axios({
        url: `${proxyUrl}${path}`,
        validateStatus: null,
        headers: {
          'apikey': 'top-secret-key'
        }
      });
      logResponse(resp);
      expect(resp.status, `Status should be 401`).to.equal(401);
      expect(resp.data, `Body should not include headers`).to.not.have.property('headers');
      expect(resp.data, `Body should not include message`).to.not.have.property('message');
      expect(resp.headers, `Headers should not include ${headersInFunctions.name}`).to.not.have.property(headersInFunctions.name);
    })
  });

  it('should delete the exit-transformer plugin by id', async function () {
    await deletePlugin(pluginId);
  });

  after(async function () {
    await clearAllKongResources()
    //Reset the KONG_UNTRUSTED_LUA to defaut value: sandbox
    await resetGatewayContainerEnvVariable(
      {
        KONG_UNTRUSTED_LUA: 'sandbox'
      },
      getKongContainerName()
    );
    if (isGwHybrid()) {
      await resetGatewayContainerEnvVariable(
        {
          KONG_UNTRUSTED_LUA: 'sandbox'
        },
        'kong-dp1'
      );
    }

  });
});
