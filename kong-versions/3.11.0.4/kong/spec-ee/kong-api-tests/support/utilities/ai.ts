import axios, { AxiosResponse } from 'axios';
import { expect } from 'chai';
import { isLoggingEnabled } from '../utilities/logging';
import {
  getUrl,
  logDebug,
  logResponse,
  getBasePath,
  isGateway,
  Environment,
  getGatewayHost,
} from '@support';
import { createConnection, Socket } from 'net';

/**
 * Retries an AI request with appropriate error handling for common AI API errors
 * @param makeRequest Function that makes the request and returns a Promise with the response
 * @param validateResponse Function that validates a successful response
 * @param provider Provider name for error messages (e.g., 'openai', 'azure', 'bedrock')
 * @param timeout Maximum time to retry in milliseconds
 * @param interval Time between retries in milliseconds
 * @returns The response from the successful request
 */
export const retryAIRequest = async (
  makeRequest: () => Promise<AxiosResponse<any>>,
  validateResponse: (resp: AxiosResponse<any>) => any,
  provider: any = 'unknown',
  timeout = 70000,
  interval = 5000
) => {
  const maxDelay = 30000;
  const start = Date.now();
  let attempt = 0;
  let lastError;

  while ((Date.now() - start) < timeout) {
    try {
      const resp = await makeRequest();

      if (isLoggingEnabled() && resp.status >= 400) {
        console.log(`Response from ${provider} on attempt ${attempt + 1}:`, resp.status, JSON.stringify(resp.data));
      };

      if (resp.status === 400) {
        if (resp.data?.error?.message?.includes('location is not supported')) {
          console.warn(`Received 400 response due to unsupported location for ${provider}, skipping failure`);
          return;
        }
        expect.fail(`Unexpected 400 response from ${provider}: ${resp.data?.error?.message || JSON.stringify(resp.data)}`);
      } else if (resp.status === 404) {
        const errorMsg = resp.data?.error?.message || '';
        if (errorMsg.includes('not found') || errorMsg.includes('models/gemini')) {
          console.warn(`Model not available in this environment: ${errorMsg}`);
          console.warn(`This is likely due to regional restrictions or preview model limitations.`);
          console.warn(`Skipping test for ${provider} model.`);
          return resp;
        }
        expect.fail(`Unexpected 404 response from ${provider}: ${errorMsg || JSON.stringify(resp.data)}`);
      } else if (resp.status === 504) {
        const msg = resp.data?.message || '';
        if (msg.includes('The upstream server is timing out')) {
          console.warn(`Received expected 504 timeout from ${provider}, skipping failure`);
          return;
        }
        expect.fail(`Unexpected 504 response from ${provider}: ${msg || 'no message'}`);
      } else if (resp.status === 429 || resp.status === 529) {
        console.error(`Rate limit exceeded for ${provider} provider`);
        throw new Error(`Rate limit exceeded: ${resp.status}`);
      } else if (resp.status === 200 || resp.status === 201) {
        return validateResponse(resp);
      } else {
        expect.fail(`Unexpected response status from ${provider}: ${resp.status}`);
      }
    } catch (err) {
      logDebug(`Attempt ${attempt + 1} failed for ${provider}: ${err}`);
      lastError = err;
      if(process.env.AI_TESTS_FAIL_FAST === 'true') {
        break;
      }
      attempt++;
      // Exponential backoff with jitter
      const delay = Math.min(interval * Math.pow(2, attempt), maxDelay) + Math.floor(Math.random() * 1000);
      if ((Date.now() - start + delay) > timeout) break;
      await new Promise(res => setTimeout(res, delay));
    }
  }
  throw lastError || new Error('AI request timed out');
};

/**
 * Validates OpenAI format response from AI provider APIs
 * @param resp The response object from the API call
 * @param expectedProvider Provider name (e.g., 'openai', 'anthropic', 'vertex')
 * @param expectedModel Expected model name
 * @param type Response type ('chat', 'completions', 'image_generation', 'tool_calls')
 */
export const evaluateAIResponseStructure = (resp: any, expectedProvider: string, expectedModel?: string | null, type = 'chat', model_name_header = true) => {
  expect(resp.status, 'Response should have status code 200').to.equal(200);
  // Check if the provider and skip id property validation if necessary
  const isAnthropic = expectedProvider === 'anthropic';
  const isVertex = expectedProvider === 'vertex';
  const isGemini = expectedProvider === 'gemini';
  const isBedrock = expectedProvider === 'bedrock';

  // vertex and gemini use 'gemini' as the provider name
  const providerName = expectedProvider === 'vertex' ? 'gemini' : expectedProvider;

  // Universal fields for all providers
  if (type !== 'image_generation') {
    expect(resp.data, 'Response should have model property').to.have.property('model');
    expect(resp.data.model, 'Response should have expected model').to.contain(expectedModel);
    expect(resp.data, 'Response should have choices property').to.have.property('choices');
    // Usage field assertions (existence and > 1)
    expect(resp.data, 'Response should have usage property').to.have.property('usage');
    const usage = resp.data.usage;
    expect(usage, 'Usage should have prompt_tokens').to.have.property('prompt_tokens');
    expect(usage, 'Usage should have completion_tokens').to.have.property('completion_tokens');
    expect(usage, 'Usage should have total_tokens').to.have.property('total_tokens');
    expect(usage.prompt_tokens, 'prompt_tokens should be > 1').to.be.a('number').and.to.be.greaterThan(1);
    expect(usage.completion_tokens, 'completion_tokens should be > 1').to.be.a('number').and.to.be.greaterThan(1);
    expect(usage.total_tokens, 'total_tokens should be > 1').to.be.a('number').and.to.be.greaterThan(1);
  }

  if (!isAnthropic && !isVertex && !isGemini && !isBedrock && type !== 'image_generation') {
    expect(resp.data, 'Response should have id property').to.have.property('id');
  }

  switch (type) {
    case 'chat':
      expect(resp.data.choices[0], 'Response should have message property').to.have.property('message');
      expect(resp.data.choices[0].message, 'Response should have role property').to.have.property('role');
      expect(resp.data.choices[0].message, 'Response should have content property').to.have.property('content');
      break;
    case 'completions':
      expect(Object.keys(resp.data.choices[0])).to.include.oneOf(['text', 'message']);
      break;
    case 'image_generation':
      logDebug(resp.data.data)
      expect(resp.data, 'Response should have data property').to.have.property('data');
      expect(resp.data.data[0], 'Response data should have url property').to.have.property('url');
      expect(resp.data.data[0].url, 'Url should contain image link').to.contain('png');
      break;
    case 'tool_calls':
      expect(resp.data.choices[0], 'Response should have message property').to.have.property('message');
      expect(resp.data.choices[0].message, 'Response should have role property').to.have.property('role');
      expect(resp.data.choices[0].message, 'Response should have tool_calls property').to.have.property('tool_calls');
      break;
  }

  if (model_name_header === true) {
    //assumes that model_name_header is true
    expect(resp.headers, 'Response should have x-kong-llm-model header').to.have.property('x-kong-llm-model');
    expect(resp.headers['x-kong-llm-model'], 'Response header should have expected model and provider').to.contain(expectedModel).and.to.contain(providerName);
  } else {
    expect(resp.headers, 'Response should not have x-kong-llm-model header').to.not.have.property('x-kong-llm-model')
  }
}

/**
 * Clear AI semantic cache
 */
export const clearSemanticCache = async function () {
  const adminUrl = `${getBasePath({
    environment: isGateway() ? Environment.gateway.admin : undefined,
  })}`;
  const resp = await axios({
    method: 'delete',
    url: `${adminUrl}/ai-semantic-cache`,
    validateStatus: null,
  });
  logResponse(resp);
  expect(resp.status, 'Response should have status code 204').to.equal(204);
}

/**
 * Gets the pgvector configuration object
 * @returns {Object} - The pgvector configuration object
 */
export const getPgvectorConfig = () => {
    return {
        host: 'host.docker.internal',
        port: 7432,
        user: 'kong',
        database: 'kong',
    }

}

async function checkPortConnectivity(host: string, port: number, timeout = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket: Socket = createConnection(port, host);

    socket.setTimeout(timeout);

    socket.on('connect', () => {
      socket.destroy();
      logDebug(`Successfully connected to ${host}:${port}`);
      resolve(true);
    });

    socket.on('timeout', () => {
      socket.destroy();
      logDebug(`Connection to ${host}:${port} timed out`);
      resolve(false);
    });

    socket.on('error', () => {
      socket.destroy();
      logDebug(`Unable to connect to ${host}:${port}`);
      resolve(false);
    });
  });
}

/**
 * Checks if the pgvector service is running healthy by checking port connectivity
 * @returns {Promise<boolean>} - True if the service is running, false otherwise
 */
export const isPgvectorHealthy = async () => {
    const pgvectorConfig = getPgvectorConfig();
    return await checkPortConnectivity(getGatewayHost(), pgvectorConfig.port);
}

/**
 * Request to create GW route
 * @param {string} name - the name of the service
 * @param {string} routeIdWithAIPlugin - the service ID that has AI Proxy enabled
 * @param {string} [routePath] - the route path for the service, defaults to `/ai/collect`
 * @returns {AxiosResponse}
 */
export const createAILogCollectingRoute = async (
  name: string,
  routeIdWithAIPlugin: string,
  collectRoutePath?: string,
) => {

  collectRoutePath = collectRoutePath || `/ai/collect`;

  // the collector plugin
  let resp = await axios({
    method: 'post',
    url: `${getUrl('routes')}/${routeIdWithAIPlugin}/plugins`,
    data: {
      name: 'post-function',
      config:{
        log: [
`
local function encode_value(value)
  local value_type = type(value)
  
  if value_type == "string" then
    return '"' .. value .. '"'
  elseif value_type == "number" then
    return tostring(value)
  elseif value_type == "table" then
    local result = {}
    
    for key, val in pairs(value) do
      if type(key) == "string" then
        table.insert(result, '"' .. key .. '":' .. encode_value(val))
      end
    end
    
    return "{" .. table.concat(result, ",") .. "}"
  end
end

local logs = kong.log.serialize()
ngx.shared.kong:set("ai_last_serialized_log_${name}", encode_value(logs and logs.ai or {}))
`
        ]
      }
    },
  });
  logResponse(resp);
  expect(resp.status, `Status should be 201`).equal(201);


  const routeResp = await axios({
    method: 'post',
    url: `${getUrl('routes')}`,
    data: {
      paths: [collectRoutePath],
    },
  })
  expect(routeResp.status, `Status should be 201`).equal(201);


  // the exposure service
  resp = await axios({
    method: 'post',
    url: `${getUrl('routes')}/${routeResp.data.id}/plugins`,
    data: {
      name: 'pre-function',
      config:{
        access: [
`
local o = ngx.shared.kong:get("ai_last_serialized_log_${name}")
ngx.shared.kong:delete("ai_last_serialized_log_${name}")
ngx.header["Content-Type"] = "application/json"
ngx.print(o or "{}")
ngx.exit(200)
`
        ]
      }
    },
  });
  logResponse(resp);
  expect(resp.status, `Status should be 201`).equal(201);
  return resp.data;
};
