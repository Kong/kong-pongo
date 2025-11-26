import axios from 'axios';
import { logDebug } from '@support';
import crypto from 'crypto';
import {
  expect,
  createGatewayService,
  createRouteForService,
  clearAllKongResources,
  getBasePath,
  isGateway,
  Environment,
  logResponse,
  waitForConfigRebuild,
  vars,
} from '@support';
import {
  chat_typical,
} from '@shared/ai/ai_gateway_setups';
import {
  aiEventsToToolCalls,
  aiEventsToContent,
  ChatCompletionCreateParamsKong,
} from '@shared/ai/helpers';
import {
  ChatCompletionTool,
  ChatCompletionSystemMessageParam,
  ChatCompletionUserMessageParam,
  ChatCompletionChunk,
  ChatCompletion,
  ChatCompletionMessageFunctionToolCall,
} from "openai/resources/chat/completions";

// type of "tests" definition
type TestConfiguration = {
  provider: string;
  model: string;
  settings: {
    apiKey?: string;
    serviceAccountJson?: string;
    locationId?: string;
    apiEndpoint?: string;
    projectId?: string;
    awsAccessKeyId?: string;
    awsSecretAccessKey?: string;
    maxTokens?: number;
    supportsArraySchema?: boolean;
    removeSystemPrompt?: boolean; // for Bedrock models
    anthropicVersion?: string; // for Gemini models
    toolCallIdPrefix?: string;
    toolCallIdLength: number;
    azureInstance?: string;
  };
};

const tests: TestConfiguration[] = [
  {
    provider: "openai",
    model: "gpt-4o",
    settings: {
      apiKey: vars.ai_providers.OPENAI_API_KEY,
      maxTokens: 16384,
      supportsArraySchema: false,
      toolCallIdPrefix: "call_",
      toolCallIdLength: 24
    }
  },
  {
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    settings: {
      apiKey: vars.ai_providers.ANTHROPIC_API_KEY,
      supportsArraySchema: false,
      toolCallIdPrefix: "call_",
      toolCallIdLength: 24,
      maxTokens: 8000,
    }
  },
  {
    provider: "azure",
    model: "gpt-4.1-mini",
    settings: {
      apiKey: vars.ai_providers.AZUREAI_API_KEY,
      supportsArraySchema: false,
      toolCallIdPrefix: "call_",
      toolCallIdLength: 24,
      azureInstance: "ai-gw-sdet-e2e-test"
    }
  },
  {
    provider: "mistral",
    model: "mistral-medium-latest",
    settings: {
      apiKey: `Bearer ${vars.ai_providers.MISTRAL_API_KEY}`,
      maxTokens: 40000,
      supportsArraySchema: false,
      toolCallIdPrefix: "",
      toolCallIdLength: 9
    }
  },
  {
    provider: "gemini",
    model: "gemini-2.5-flash",
    settings: {
      serviceAccountJson: vars.ai_providers.VERTEX_API_KEY,
      locationId: "us-central1",
      apiEndpoint: "us-central1-aiplatform.googleapis.com",
      projectId: "gcp-sdet-test",
      toolCallIdPrefix: "call_",
      toolCallIdLength: 24
    }
  },
  {
    provider: "gemini",
    model: "gemini-2.5-pro",
    settings: {
      serviceAccountJson: vars.ai_providers.VERTEX_API_KEY,
      locationId: "us-central1",
      apiEndpoint: "us-central1-aiplatform.googleapis.com",
      projectId: "gcp-sdet-test",
      maxTokens: 8192,  // doesn't support long inference
      toolCallIdPrefix: "call_",
      toolCallIdLength: 24
    }
  },
  {
    provider: "gemini",
    model: "claude-opus-4-1",
    settings: {
      serviceAccountJson: `${vars.ai_providers.VERTEX_API_KEY}`,
      locationId: "us-east5",
      apiEndpoint: "us-east5-aiplatform.googleapis.com",
      projectId: "gcp-sdet-test",
      maxTokens: 32000,
      anthropicVersion: "vertex-2023-10-16",  // doesn't look like this is ever used or updated by Google?
      supportsArraySchema: false,
      toolCallIdPrefix: "call_",
      toolCallIdLength: 24
    }
  },
  {
    provider: "bedrock",
    model: "amazon.nova-lite-v1:0",
    settings: {
      awsAccessKeyId: vars.aws.AWS_ACCESS_KEY_ID,
      awsSecretAccessKey: vars.aws.AWS_SECRET_ACCESS_KEY,
      supportsArraySchema: false,
      toolCallIdPrefix: "tooluse_",
      toolCallIdLength: 22,
    }
  },
  {
    provider: "bedrock",
    model: "us.anthropic.claude-sonnet-4-20250514-v1:0",
    settings: {
      awsAccessKeyId: vars.aws.AWS_ACCESS_KEY_ID,
      awsSecretAccessKey: vars.aws.AWS_SECRET_ACCESS_KEY,
      supportsArraySchema: false,
      toolCallIdPrefix: "tooluse_",
      toolCallIdLength: 22,
    }
  }
];


const SETUP_MESSAGES: Record<string, ChatCompletionSystemMessageParam| ChatCompletionUserMessageParam> = {
  SYSTEM: {
    "role": "system",
    "content": "You are an expert on usage metadata in my API Gateway system. You are able to use the provided tools to get information about user's usage, as well as the weather and conditions where they live. You can make multiple tool calls simultaneously. Use the tools provided."
  },
  USER: {
    "role": "user",
    "content": "You can call many functions concurrently. Tell me the usage stats per-minute for these three consumers: (ID 101), (ID 102), (ID 103). You'll have to get their metadata first (by username query). Then concurrently get their API usage stats, their local current weather from those cities. Finally, pass the CENTIGRADE temperature into the secret cipher, and replace the 'centigrade' in your response with the 'secret cipher' output."
  },
};
const TOOL_CALL_FIXTURES = {
  TOOL_CALL_01_CONSUMER_METADATA: "{\"consumers\":[{\"id\":101,\"username\":\"JACKT\",\"city\":\"New York\",\"country\":\"USA\"},{\"id\":102,\"username\":\"AURIST\",\"city\":\"Oslo\",\"country\":\"Norway\"},{\"id\":103,\"username\":\"JOSEP\",\"city\":\"Madrid\",\"country\":\"Spain\"}]}",
  TOOL_CALL_02_CONSUMER_USAGE_STATS: "{\"api_usage\":[{\"id\":101,\"per_minute\":600},{\"id\":102,\"per_minute\":400},{\"id\":103,\"per_minute\":300}]}",
  TOOL_CALL_03_NEW_YORK_TEMP: "{\"centigrade\":30,\"fahrenheit\":86}",
  TOOL_CALL_04_OSLO_TEMP: "{\"centigrade\":35,\"fahrenheit\":95}",
  TOOL_CALL_05_MADRID_TEMP: "{\"centigrade\":40,\"fahrenheit\":104}",
  TOOL_CALL_06_SECRET_CIPHER_JACKT: "201",
  TOOL_CALL_07_SECRET_CIPHER_AURIST: "202",
  TOOL_CALL_08_SECRET_CIPHER_JOSE: "203"
};

const TOOLS_AVAILABLE: ChatCompletionTool[] = [
  {
    "type": "function",
    "function": {
      "name": "get_consumer_metadata_from_ids",
      "description": "Gets consumer's metadata from the IDs. Accepts an array of consumer IDs.",
      "parameters": {
        "type": "object",
        "properties": {
          "consumer_ids": {
            "type": "array",
            "items": {
              "type": "string",
              "description": "The consumer's ID"
            },
            "required": [
              "consumer_ids"
            ],
            "additionalProperties": false
          }
        }
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "get_multiple_consumer_api_usage_per_minute",
      "description": "Get API usage statistics per minute for multiple consumers. Pass all required consumers as an array of string.",
      "parameters": {
        "type": "object",
        "properties": {
          "consumers": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "username": {
                  "type": "string",
                  "description": "The consumer's username"
                }
              },
              "required": [
                "username"
              ],
              "additionalProperties": false
            },
            "required": [
              "consumers"
            ],
            "additionalProperties": false
          }
        }
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "get_weather_in_city_in_centigrade_and_fahrenheit",
      "description": "Get the current weather in a specific city in both Centigrade and Fahrenheit.",
      "parameters": {
        "type": "object",
        "properties": {
          "city": {
            "type": "string",
            "description": "The requested city name"
          },
          "country": {
            "type": "string",
            "description": "The requested country name"
          }
        },
        "required": [
          "city",
          "country"
        ],
        "additionalProperties": false
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "secret_cipher",
      "description": "Get the secret cipher value for a specific temperature.",
      "parameters": {
        "type": "object",
        "properties": {
          "temperature": {
            "type": "number",
            "description": "The temperature in Centigrade"
          }
        },
        "required": [
          "temperature"
        ],
        "additionalProperties": false
      }
    }
  }
];

// Retry utility function
async function withRetry(testFn, maxRetries: number) {
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await testFn();
      return;

    } catch (error) {
      lastError = error;

      if (attempt < maxRetries) {
        logDebug(`Attempt ${attempt} failed, ${error}, retrying... (${maxRetries - attempt} retries left)`);
      }
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  // If all retries failed, throw the last error
  throw lastError;
}

const getTestTags = (provider: string, model: string): string => {
  const weeklyModels = [
    'claude-opus'
  ];
  
  const shouldBeWeekly = weeklyModels.some(weeklyModel => 
    model.toLowerCase().includes(weeklyModel.toLowerCase())
  );
  
  return shouldBeWeekly ? '@weekly ' : '';
};


describe("@ai: Gateway Plugins: AI Proxy Advanced Tools Use", function () {
  const basePath = "/ai_proxy_advanced_tools_use_spec";

  const adminUrl = getBasePath({
    environment: isGateway() ? Environment.gateway.admin : undefined,
  });

  before(async function () {
    // add header to every axios request in this suite
    axios.defaults.headers.common['Accept-Encoding'] = 'application/json,gzip,deflate';

    // create a service and route for use with plugin
    const service = await createGatewayService('ai-test-service');
    const serviceId = service.id;

    // create a route and plugin for each test case
    for (const test of tests) {
      const testIdentifier = `${test.provider}_${test.model}`;
      const route = await createRouteForService(serviceId, [`~${basePath}/${testIdentifier}$`]);
      const routeId = route.id;

      const testConfiguration = chat_typical(test.model, test.settings)[test.provider];

      const pluginPayload = {
        config: {
          max_request_body_size: 8192,
          llm_format: 'openai',
          model_name_header: true,
          response_streaming: 'allow',
          targets: [
            {
              ...testConfiguration.target
            }
          ],
          balancer: {
            algorithm: 'round-robin',
            latency_strategy: 'tpot',
            retries: 5,
            slots: 1000,
            hash_on_header: 'X-Kong-LLM-Request-ID',
            failover_criteria: [
              'error',
              'timeout'
            ],
            connect_timeout: 60000,
            read_timeout: 60000,
            write_timeout: 60000,
            tokens_count_strategy: 'cost'
          }
        },
        route: { id: '' },
        name: 'ai-proxy-advanced'
      };

      // setting service id to plugin payload as we can now access the serviceId inside it (test) scope
      pluginPayload.route.id = routeId;

      const resp = await axios({
        method: 'post',
        url: `${adminUrl}/services/${serviceId}/plugins`,
        data: pluginPayload,
        validateStatus: null
      });

      logResponse(resp);

      expect(resp.status, 'Status should be 201').to.equal(201);
      expect(resp.headers['content-type'], 'Should have content-type header set to application/json').to.contain('application/json');
      expect(resp.data.name, 'Should have correct plugin name').to.equal('ai-proxy-advanced');
    }

    await waitForConfigRebuild();
  });
  
  // tests entrypoint
  for (const test of tests) {
    const testIdentifier = `${test.provider}_${test.model}`;
    const path = `/${basePath}/${testIdentifier}`;

    const proxyUrl = getBasePath({
      environment: isGateway() ? Environment.gateway.proxy : undefined,
    });

    const makeToolUseRequestStage1 = async (
      proxyUrl: string,
      path: string,
      isStream = false
    ): Promise<ChatCompletion | ChatCompletionChunk[]> => {

      const jsonBody: ChatCompletionCreateParamsKong = {
        "messages": [
          SETUP_MESSAGES.SYSTEM,
          SETUP_MESSAGES.USER,
        ],
        "tools": TOOLS_AVAILABLE,
        "stream": isStream
      };

      // Some Bedrock models still don't support system prompts
      if (('removeSystemPrompt' in test.settings && test.settings.removeSystemPrompt)) {
        jsonBody.messages = jsonBody.messages.filter(m => m.role !== 'system');
      }

      if (isStream) {
        const events_o: ChatCompletionChunk[] = [];

        const stream = await axios.post(
          `${proxyUrl}${path}`,
          jsonBody, {
          headers: {
            'Accept': 'text/event-stream',
          },
          responseType: 'stream',
          adapter: 'fetch',
        });


        // consume each frame
        const reader = stream.data.pipeThrough(new TextDecoderStream()).getReader();
        for (; ;) {
          const { value, done } = await reader.read();
          if (done) break;

          const events: string[] = (value as string).split("\n\n");
          if (events !== undefined && events.length > 0) {

            events.forEach((ev) => {
              if (ev && ev.length > 5 && ev.substring(0, 5) == "data:" && ev.indexOf('{') > 5) {
                events_o.push(JSON.parse(ev.substring(ev.indexOf('{'))));
              }
            });

          }
        }

        return events_o;
      } else {
        const resp = await axios.post(
          `${proxyUrl}${path}`,
          jsonBody
        );

        logResponse(resp);

        return resp.data;
      }
    };

    const makeToolUseRequestStage2 = async (
      proxyUrl: string,
      path: string,
      isStream = false,
      toolCallIdPrefix: string,
      toolCallIdLength: number
    ): Promise<ChatCompletion | ChatCompletionChunk[]> => {

      const toolCallIds = {
        toolCall01: `${toolCallIdPrefix}${crypto.randomBytes(32).toString('hex').slice(0, toolCallIdLength)}`
      };

      const jsonBody: ChatCompletionCreateParamsKong = {
        "messages": [
          SETUP_MESSAGES.SYSTEM,
          SETUP_MESSAGES.USER,
          {
            "role": "assistant",
            "content": null,
            "tool_calls": [
              {
                "id": toolCallIds.toolCall01,
                "type": "function",
                "function": {
                  "name": "get_consumer_metadata_from_ids",
                  "arguments": "{\"consumer_ids\":[\"101\",\"102\",\"103\"]}"
                }
              }
            ]
          },
          {
            "role": "tool",
            "tool_call_id": toolCallIds.toolCall01,
            "content": TOOL_CALL_FIXTURES.TOOL_CALL_01_CONSUMER_METADATA
          }
        ],
        "tools": TOOLS_AVAILABLE,
        "stream": isStream
      };

      // Some Bedrock models still don't support system prompts
      if (('removeSystemPrompt' in test.settings && test.settings.removeSystemPrompt)) {
        jsonBody.messages = jsonBody.messages.filter(m => m.role !== 'system');
      }

      if (isStream) {
        const events_o: ChatCompletionChunk[] = [];

        const stream = await axios.post(
          `${proxyUrl}${path}`,
          jsonBody, {
          headers: {
            'Accept': 'text/event-stream',
          },
          responseType: 'stream',
          adapter: 'fetch',
        });


        // consume each frame
        const reader = stream.data.pipeThrough(new TextDecoderStream()).getReader();
        for (; ;) {
          const { value, done } = await reader.read();
          if (done) break;

          const events: string[] = (value as string).split("\n\n");
          if (events !== undefined && events.length > 0) {

            events.forEach((ev) => {
              if (ev && ev.length > 5 && ev.substring(0, 5) == "data:" && ev.indexOf('{') > 5) {
                events_o.push(JSON.parse(ev.substring(ev.indexOf('{'))));
              }
            });

          }
        }

        return events_o;
      } else {
        const resp = await axios.post(
          `${proxyUrl}${path}`,
          jsonBody
        );

        logResponse(resp);

        return resp.data;
      }
    };

    const makeToolUseRequestStage2_5 = async (
      proxyUrl: string,
      path: string,
      isStream = false,
      toolCallIdPrefix: string,
      toolCallIdLength: number
    ): Promise<ChatCompletion | ChatCompletionChunk[]> => {

      const toolCallIds = {
        toolCall01: `${toolCallIdPrefix}${crypto.randomBytes(32).toString('hex').slice(0, toolCallIdLength)}`
      };

      const jsonBody: ChatCompletionCreateParamsKong = {
        "messages": [
          {
            "role": "system",
            "content": "Use the available tool to answer the question, explain why you're using the tool."
          },
          {
            "role": "user",
            "content": "What are the consumer IDs?"
          },
          {
            "role": "assistant",
            "content": "** THINKING ** Okay so to get the consumer IDs, I need to use the get_consumer_ids tool.",
            "tool_calls": [
              {
                "id": toolCallIds.toolCall01,
                "type": "function",
                "function": {
                  "name": "get_consumer_ids",
                  "arguments": "{}"
                }
              }
            ]
          },
          {
            "role": "tool",
            "tool_call_id": toolCallIds.toolCall01,
            "content": "{\"consumer_ids\":[\"101\",\"102\",\"103\"]}"
          }
        ],
        "tools": [
          {
            "type": "function",
            "function": {
              "name": "get_consumer_ids",
              "description": "Gets consumer IDs.",
              "parameters": {
                "type": "object",
                "properties": {}
              }
            }
          }
        ],
        "stream": isStream
      };

      // Some Bedrock models still don't support system prompts
      if (('removeSystemPrompt' in test.settings && test.settings.removeSystemPrompt)) {
        jsonBody.messages = jsonBody.messages.filter(m => m.role !== 'system');
      }

      if (isStream) {
        const events_o: ChatCompletionChunk[] = [];

        const stream = await axios.post(
          `${proxyUrl}${path}`,
          jsonBody, {
          headers: {
            'Accept': 'text/event-stream',
          },
          responseType: 'stream',
          adapter: 'fetch',
        });


        // consume each frame
        const reader = stream.data.pipeThrough(new TextDecoderStream()).getReader();
        for (; ;) {
          const { value, done } = await reader.read();
          if (done) break;

          const events: string[] = (value as string).split("\n\n");
          if (events !== undefined && events.length > 0) {

            events.forEach((ev) => {
              if (ev && ev.length > 5 && ev.substring(0, 5) == "data:" && ev.indexOf('{') > 5) {
                events_o.push(JSON.parse(ev.substring(ev.indexOf('{'))));
              }
            });
          }
        }

        return events_o;
      } else {
        const resp = await axios.post(
          `${proxyUrl}${path}`,
          jsonBody
        );

        logResponse(resp);

        return resp.data;
      }
    };

    const makeToolUseRequestStage3 = async (
      proxyUrl: string,
      path: string,
      isStream = false,
      toolCallIdPrefix: string,
      toolCallIdLength: number
    ): Promise<ChatCompletion | ChatCompletionChunk[]> => {

      const toolCallIds = {
        toolCall01: `${toolCallIdPrefix}${crypto.randomBytes(32).toString('hex').slice(0, toolCallIdLength)}`,
        toolCall02: `${toolCallIdPrefix}${crypto.randomBytes(32).toString('hex').slice(0, toolCallIdLength)}`,
        toolCall03: `${toolCallIdPrefix}${crypto.randomBytes(32).toString('hex').slice(0, toolCallIdLength)}`,
        toolCall04: `${toolCallIdPrefix}${crypto.randomBytes(32).toString('hex').slice(0, toolCallIdLength)}`,
        toolCall05: `${toolCallIdPrefix}${crypto.randomBytes(32).toString('hex').slice(0, toolCallIdLength)}`
      };

      const jsonBody: ChatCompletionCreateParamsKong = {
        "messages": [
          SETUP_MESSAGES.SYSTEM,
          SETUP_MESSAGES.USER,
          {
            "role": "assistant",
            "content": null,
            "tool_calls": [
              {
                "id": toolCallIds.toolCall01,
                "type": "function",
                "function": {
                  "name": "get_consumer_metadata_from_ids",
                  "arguments": "{\"consumer_ids\":[\"101\",\"102\",\"103\"]}"
                }
              }
            ]
          },
          {
            "role": "tool",
            "tool_call_id": toolCallIds.toolCall01,
            "content": TOOL_CALL_FIXTURES.TOOL_CALL_01_CONSUMER_METADATA
          },
          {
            "role": "assistant",
            "content": null,
            "tool_calls": [
              {
                "id": toolCallIds.toolCall02,
                "type": "function",
                "function": {
                  "name": "get_multiple_consumer_api_usage_per_minute",
                  "arguments": "{\"consumers\":[{\"username\":\"JACKT\"},{\"username\":\"AURIST\"},{\"username\":\"JOSEP\"}]}"
                }
              },
              {
                "id": toolCallIds.toolCall03,
                "type": "function",
                "function": {
                  "name": "get_weather_in_city_in_centigrade_and_fahrenheit",
                  "arguments": "{\"country\": \"USA\", \"city\": \"New York\"}"
                }
              },
              {
                "id": toolCallIds.toolCall04,
                "type": "function",
                "function": {
                  "name": "get_weather_in_city_in_centigrade_and_fahrenheit",
                  "arguments": "{\"country\": \"Norway\", \"city\": \"Oslo\"}"
                }
              },
              {
                "id": toolCallIds.toolCall05,
                "type": "function",
                "function": {
                  "name": "get_weather_in_city_in_centigrade_and_fahrenheit",
                  "arguments": "{\"country\": \"Spain\", \"city\": \"Madrid\"}"
                }
              }
            ]
          },
          {
            "role": "tool",
            "tool_call_id": toolCallIds.toolCall02,
            "content": TOOL_CALL_FIXTURES.TOOL_CALL_02_CONSUMER_USAGE_STATS
          },
          {
            "role": "tool",
            "tool_call_id": toolCallIds.toolCall03,
            "content": TOOL_CALL_FIXTURES.TOOL_CALL_03_NEW_YORK_TEMP
          },
          {
            "role": "tool",
            "tool_call_id": toolCallIds.toolCall04,
            "content": TOOL_CALL_FIXTURES.TOOL_CALL_04_OSLO_TEMP
          },
          {
            "role": "tool",
            "tool_call_id": toolCallIds.toolCall05,
            "content": TOOL_CALL_FIXTURES.TOOL_CALL_05_MADRID_TEMP
          }
        ],
        "tools": TOOLS_AVAILABLE,
        "stream": isStream
      };

      // Some Bedrock models still don't support system prompts
      if (('removeSystemPrompt' in test.settings && test.settings.removeSystemPrompt)) {
        jsonBody.messages = jsonBody.messages.filter(m => m.role !== 'system');
      }

      if (isStream) {
        const events_o: ChatCompletionChunk[] = [];

        const stream = await axios.post(
          `${proxyUrl}${path}`,
          jsonBody, {
          headers: {
            'Accept': 'text/event-stream',
          },
          responseType: 'stream',
          adapter: 'fetch',
        });


        // consume each frame
        const reader = stream.data.pipeThrough(new TextDecoderStream()).getReader();
        for (; ;) {
          const { value, done } = await reader.read();
          if (done) break;

          const events: string[] = (value as string).split("\n\n");
          if (events !== undefined && events.length > 0) {

            events.forEach((ev) => {
              if (ev && ev.length > 5 && ev.substring(0, 5) == "data:" && ev.indexOf('{') > 5) {
                events_o.push(JSON.parse(ev.substring(ev.indexOf('{'))));
              }
            });

          }
        }

        return events_o;
      } else {
        const resp = await axios.post(
          `${proxyUrl}${path}`,
          jsonBody
        );

        logResponse(resp);

        return resp.data;
      }
    };

    const makeToolUseRequestStage4 = async (
      proxyUrl: string,
      path: string,
      isStream = false,
      toolCallIdPrefix: string,
      toolCallIdLength: number
    ): Promise<ChatCompletion | ChatCompletionChunk[]> => {

      const toolCallIds = {
        toolCall01: `${toolCallIdPrefix}${crypto.randomBytes(32).toString('hex').slice(0, toolCallIdLength)}`,
        toolCall02: `${toolCallIdPrefix}${crypto.randomBytes(32).toString('hex').slice(0, toolCallIdLength)}`,
        toolCall03: `${toolCallIdPrefix}${crypto.randomBytes(32).toString('hex').slice(0, toolCallIdLength)}`,
        toolCall04: `${toolCallIdPrefix}${crypto.randomBytes(32).toString('hex').slice(0, toolCallIdLength)}`,
        toolCall05: `${toolCallIdPrefix}${crypto.randomBytes(32).toString('hex').slice(0, toolCallIdLength)}`,
        toolCall06: `${toolCallIdPrefix}${crypto.randomBytes(32).toString('hex').slice(0, toolCallIdLength)}`,
        toolCall07: `${toolCallIdPrefix}${crypto.randomBytes(32).toString('hex').slice(0, toolCallIdLength)}`,
        toolCall08: `${toolCallIdPrefix}${crypto.randomBytes(32).toString('hex').slice(0, toolCallIdLength)}`
      };

      const jsonBody: ChatCompletionCreateParamsKong = {
        "messages": [
          SETUP_MESSAGES.SYSTEM,
          SETUP_MESSAGES.USER,
          {
            "role": "assistant",
            "content": null,
            "tool_calls": [
              {
                "id": toolCallIds.toolCall01,
                "type": "function",
                "function": {
                  "name": "get_consumer_metadata_from_ids",
                  "arguments": "{\"consumer_ids\":[\"101\",\"102\",\"103\"]}"
                }
              }
            ]
          },
          {
            "role": "tool",
            "tool_call_id": toolCallIds.toolCall01,
            "content": TOOL_CALL_FIXTURES.TOOL_CALL_01_CONSUMER_METADATA
          },
          {
            "role": "assistant",
            "content": null,
            "tool_calls": [
              {
                "id": toolCallIds.toolCall02,
                "type": "function",
                "function": {
                  "name": "get_multiple_consumer_api_usage_per_minute",
                  "arguments": "{\"consumers\": [{\"username\": \"JACKT\"}, {\"username\": \"AURIST\"}, {\"username\": \"JOSEP\"}]}"
                }
              },
              {
                "id": toolCallIds.toolCall03,
                "type": "function",
                "function": {
                  "name": "get_weather_in_city_in_centigrade_and_fahrenheit",
                  "arguments": "{\"country\": \"USA\", \"city\": \"New York\"}"
                }
              },
              {
                "id": toolCallIds.toolCall04,
                "type": "function",
                "function": {
                  "name": "get_weather_in_city_in_centigrade_and_fahrenheit",
                  "arguments": "{\"country\": \"Norway\", \"city\": \"Oslo\"}"
                }
              },
              {
                "id": toolCallIds.toolCall05,
                "type": "function",
                "function": {
                  "name": "get_weather_in_city_in_centigrade_and_fahrenheit",
                  "arguments": "{\"country\": \"Spain\", \"city\": \"Madrid\"}"
                }
              }
            ]
          },
          {
            "role": "tool",
            "tool_call_id": toolCallIds.toolCall02,
            "content": TOOL_CALL_FIXTURES.TOOL_CALL_02_CONSUMER_USAGE_STATS
          },
          {
            "role": "tool",
            "tool_call_id": toolCallIds.toolCall03,
            "content": TOOL_CALL_FIXTURES.TOOL_CALL_03_NEW_YORK_TEMP
          },
          {
            "role": "tool",
            "tool_call_id": toolCallIds.toolCall04,
            "content": TOOL_CALL_FIXTURES.TOOL_CALL_04_OSLO_TEMP
          },
          {
            "role": "tool",
            "tool_call_id": toolCallIds.toolCall05,
            "content": TOOL_CALL_FIXTURES.TOOL_CALL_05_MADRID_TEMP
          },
          {
            "role": "assistant",
            "content": null,
            "tool_calls": [
              {
                "id": toolCallIds.toolCall06,
                "type": "function",
                "function": {
                  "name": "secret_cipher",
                  "arguments": "{\"temperature\": 30}"
                }
              },
              {
                "id": toolCallIds.toolCall07,
                "type": "function",
                "function": {
                  "name": "secret_cipher",
                  "arguments": "{\"temperature\": 35}"
                }
              },
              {
                "id": toolCallIds.toolCall08,
                "type": "function",
                "function": {
                  "name": "secret_cipher",
                  "arguments": "{\"temperature\": 40}"
                }
              }
            ]
          },
          {
            "role": "tool",
            "tool_call_id": toolCallIds.toolCall06,
            "content": TOOL_CALL_FIXTURES.TOOL_CALL_06_SECRET_CIPHER_JACKT
          },
          {
            "role": "tool",
            "tool_call_id": toolCallIds.toolCall07,
            "content": TOOL_CALL_FIXTURES.TOOL_CALL_07_SECRET_CIPHER_AURIST
          },
          {
            "role": "tool",
            "tool_call_id": toolCallIds.toolCall08,
            "content": TOOL_CALL_FIXTURES.TOOL_CALL_08_SECRET_CIPHER_JOSE
          }
        ],
        "tools": TOOLS_AVAILABLE,
        "stream": isStream
      };

      // Some Bedrock models still don't support system prompts
      if (('removeSystemPrompt' in test.settings && test.settings.removeSystemPrompt)) {
        jsonBody.messages = jsonBody.messages.filter(m => m.role !== 'system');
      }

      if (isStream) {
        const events_o: ChatCompletionChunk[] = [];

        const stream = await axios.post(
          `${proxyUrl}${path}`,
          jsonBody, {
          headers: {
            'Accept': 'text/event-stream',
          },
          responseType: 'stream',
          adapter: 'fetch',
        });

        // consume each frame
        const reader = stream.data.pipeThrough(new TextDecoderStream()).getReader();
        for (; ;) {
          const { value, done } = await reader.read();
          if (done) break;

          const events: string[] = (value as string).split("\n\n");
          if (events !== undefined && events.length > 0) {

            events.forEach((ev) => {
              if (ev && ev.length > 5 && ev.substring(0, 5) == "data:" && ev.indexOf('{') > 5) {
                events_o.push(JSON.parse(ev.substring(ev.indexOf('{'))));
              }
            });

          }
        }

        return events_o;
      } else {
        const resp = await axios.post(
          `${proxyUrl}${path}`,
          jsonBody
        );

        logResponse(resp);

        return resp.data;
      }
    };

    describe(`${getTestTags(test.provider, test.model)} @ai: ${test.provider} (${test.model}) [text/event-stream]`, function () {
      it('stage 1: replies with the initial discovery function call', async function () {
        await withRetry(async () => {
          const events = await makeToolUseRequestStage1(proxyUrl, path, true) as ChatCompletionChunk[];

          const toolCalls = aiEventsToToolCalls(events);

          expect(toolCalls).to.have.lengthOf(1, 'Should have one tool call in the response');
          expect(toolCalls[0].function.name, 'Should call `get_consumer_metadata_from_ids` function with an array parameter').to.equal('get_consumer_metadata_from_ids');

          const tool_1_args = JSON.parse(toolCalls[0].function.arguments);
          expect(tool_1_args).to.have.property('consumer_ids').that.is.an('array').that.is.not.empty;
          expect(tool_1_args.consumer_ids).to.have.members(['101', '102', '103'], 'Should have consumer IDs 101, 102, and 103 in the tool call args');
        }, 5)
      });

      it('stage 2: we reply with consumer metadata, then the model requests function answers for consumer API usage per-minute and city weather (order-insensitive)', async function () {
        await withRetry(async () => {
          const events = await makeToolUseRequestStage2(proxyUrl, path, true, test.settings.toolCallIdPrefix as string, test.settings.toolCallIdLength as number) as ChatCompletionChunk[];

          const toolCalls = aiEventsToToolCalls(events);
          expect(toolCalls).to.have.lengthOf(4, 'Should have four tool calls in the response');

          // Check that the correct tool calls are present, ignoring the random "id" fields and order
          const toolCallss = toolCalls.map((call: any) => ({
            type: call.type || "function",  // some providers omit this, but it doesn't break anything
            function: {
              name: call.function.name,
              arguments: JSON.parse(call.function.arguments)
            }
          }));

          const expectedToolCalls = [
            {
              type: "function",
              function: {
                name: "get_weather_in_city_in_centigrade_and_fahrenheit",
                arguments: {"country": "USA", "city": "New York"}
              }
            },
            {
              type: "function",
              function: {
                name: "get_weather_in_city_in_centigrade_and_fahrenheit",
                arguments: {"country": "Norway", "city": "Oslo"},
              }
            },
            {
              type: "function",
              function: {
                name: "get_multiple_consumer_api_usage_per_minute",
                arguments: {"consumers": [{"username": "JACKT"}, {"username": "AURIST"}, {"username": "JOSEP"}]},
              }
            },
            {
              type: "function",
              function: {
                name: "get_weather_in_city_in_centigrade_and_fahrenheit",
                arguments:{"country": "Spain", "city": "Madrid"},
              }
            }
          ];

          expect(toolCallss, 'Should contain all expected tool calls, order-insensitive').to.have.deep.members(expectedToolCalls);
        }, 5)
      });

      it('stage 3: we respond with consumer API usage per minute and city weather, then model request function answers for secret-cipher (order-insensitive)', async function () {
        await withRetry(async () => {
          const events = await makeToolUseRequestStage3(proxyUrl, path, true, test.settings.toolCallIdPrefix as string, test.settings.toolCallIdLength as number) as ChatCompletionChunk[];

          const toolCalls = aiEventsToToolCalls(events);
          expect(toolCalls).to.have.lengthOf(3, 'Should have three tool calls in the response');

          // Check that the correct tool calls are present, ignoring the random "id" fields and order
          const toolCallss = toolCalls.map((call: any) => ({
            type: call.type || "function",  // some providers omit this, but it doesn't break anything
            function: {
              name: call.function.name,
              arguments: JSON.parse(call.function.arguments)
            }
          }));

          const expectedToolCalls = [
            {
              type: "function",
              function: {
                name: "secret_cipher",
                arguments: {"temperature": 35}
              }
            },
            {
              type: "function",
              function: {
                name: "secret_cipher",
                arguments: {"temperature": 40}
              }
            },
            {
              type: "function",
              function: {
                name: "secret_cipher",
                arguments: {"temperature": 30}
              }
            }
          ];

          // Use deep.members for order-insensitive comparison
          expect(toolCallss, 'Should contain all expected tool calls, order-insensitive').to.have.deep.members(expectedToolCalls);
        }, 5)
      });

      it('stage 4: respond with correct secret ciphers based off local function result(s)', async function () {
        await withRetry(async () => {
          const events = await makeToolUseRequestStage4(proxyUrl, path, true, test.settings.toolCallIdPrefix as string, test.settings.toolCallIdLength as number) as ChatCompletionChunk[];

          const content = aiEventsToContent(events);
          expect(content).length.to.be.greaterThan(1, 'Message content should be at least one byte');

          [
            "600", "201",
            "400", "202",
            "300", "203"
          ].forEach(str => {
            expect(content, `Should contain "${str}" in the response`).to.contain(str);
          });
        }, 5)
      });
    });

    describe(`${getTestTags(test.provider, test.model)} @ai: ${test.provider} (${test.model}) [application/json]`, function () {
      it('stage 1: replies with the initial discovery function call', async function () {
        await withRetry(async () => {
          const stage1 = await makeToolUseRequestStage1(proxyUrl, path, false) as ChatCompletion;

          expect(stage1.choices).to.have.lengthOf(1, 'Should have one message candidate in the response');
          expect(stage1.choices[0].message.tool_calls).to.have.lengthOf(1, 'Should have one tool call in the response');
          const func0 = stage1.choices[0].message.tool_calls?.[0] as ChatCompletionMessageFunctionToolCall;
          expect(func0.function.name, 'Should call `get_consumer_metadata_from_ids` function with an array parameter').to.equal('get_consumer_metadata_from_ids');

          const tool_1_args = JSON.parse(func0.function.arguments || '{}');
          expect(tool_1_args).to.have.property('consumer_ids').that.is.an('array').that.is.not.empty;
          expect(tool_1_args.consumer_ids).to.have.members(['101', '102', '103'], 'Should have consumer IDs 101, 102, and 103 in the tool call args');
        }, 5)
      });

      it('stage 2: we reply with consumer metadata, then the model requests function answers for consumer API usage per-minute and city weather (order-insensitive)', async function () {
        await withRetry(async () => {
          const stage2 = await makeToolUseRequestStage2(proxyUrl, path, false, test.settings.toolCallIdPrefix as string, test.settings.toolCallIdLength as number) as ChatCompletion;

          expect(stage2.choices).to.have.lengthOf(1, 'Should have one message candidate in the response');

          expect(stage2.choices).to.have.lengthOf(1, 'Should have one message candidate in the response');
          expect(stage2.choices[0].message.tool_calls).to.have.lengthOf(4, 'Should have four tool calls in the response');

          // Check that the correct tool calls are present, ignoring the random "id" fields and order
          const toolCalls = stage2.choices[0].message.tool_calls?.map((call: any) => ({
            type: call.type || "function",  // some providers omit this, but it doesn't break anything
            function: {
              name: call.function.name,
              arguments: JSON.parse(call.function.arguments)
            }
          }));

          const expectedToolCalls = [
            {
              type: "function",
              function: {
                name: "get_weather_in_city_in_centigrade_and_fahrenheit",
                arguments: {"country": "USA", "city": "New York"}
              }
            },
            {
              type: "function",
              function: {
                name: "get_weather_in_city_in_centigrade_and_fahrenheit",
                arguments: {"country": "Norway", "city": "Oslo"}
              }
            },
            {
              type: "function",
              function: {
                name: "get_multiple_consumer_api_usage_per_minute",
                arguments: {"consumers": [{"username": "JACKT"}, {"username": "AURIST"}, {"username": "JOSEP"}]}
              }
            },
            {
              type: "function",
              function: {
                name: "get_weather_in_city_in_centigrade_and_fahrenheit",
                arguments: {"country": "Spain", "city": "Madrid"}
              }
            }
          ];

          expect(toolCalls, 'Should contain all expected tool calls, order-insensitive').to.have.deep.members(expectedToolCalls);
        }, 5)
      });

      it('stage 2.5: responds with good answer, when request contains a mixed-mode text+tool_use turn', async function () {
        await withRetry(async () => {
          const stage2_5 = await makeToolUseRequestStage2_5(proxyUrl, path, false, test.settings.toolCallIdPrefix as string, test.settings.toolCallIdLength as number) as ChatCompletion;

          expect(stage2_5.choices).to.have.lengthOf(1, 'Should have one message candidate in the response');
          expect(stage2_5.choices[0].message.content, 'Check for one of the consumer IDs [because flake]').to.contain('101');
        }, 5);
      });

      it('stage 3: we respond with consumer API usage per minute and city weather, then model request function answers for secret-cipher (order-insensitive)', async function () {
        await withRetry(async () => {
          const stage3 = await makeToolUseRequestStage3(proxyUrl, path, false, test.settings.toolCallIdPrefix as string, test.settings.toolCallIdLength as number) as ChatCompletion;

          expect(stage3.choices).to.have.lengthOf(1, 'Should have one message candidate in the response');
          expect(stage3.choices[0].message.tool_calls).to.have.lengthOf(3, 'Should have three tool calls in the response');

          // Check that the correct tool calls are present, ignoring the random "id" fields and order
          const toolCalls = stage3.choices[0].message.tool_calls?.map((call: any) => ({
            type: call.type || "function",  // some providers omit this, but it doesn't break anything
            function: {
              name: call.function.name,
              arguments: JSON.parse(call.function.arguments)
            }
          }));

          const expectedToolCalls = [
            {
              type: "function",
              function: {
                name: "secret_cipher",
                arguments: {"temperature": 35}
              }
            },
            {
              type: "function",
              function: {
                name: "secret_cipher",
                arguments: {"temperature": 40}
              }
            },
            {
              type: "function",
              function: {
                name: "secret_cipher",
                arguments: {"temperature": 30}
              }
            }
          ];

          // Use deep.members for order-insensitive comparison
          expect(toolCalls, 'Should contain all expected tool calls, order-insensitive').to.have.deep.members(expectedToolCalls);
        }, 5)
      });

      it('stage 4: respond with correct secret ciphers based off local function result(s)', async function () {
        await withRetry(async () => {
          const stage4 = await makeToolUseRequestStage4(proxyUrl, path, false, test.settings.toolCallIdPrefix as string, test.settings.toolCallIdLength as number) as ChatCompletion;

          expect(stage4.choices).to.have.lengthOf(1, 'Should have one message candidate in the response');
          expect(stage4?.choices[0].message.content).length.to.be.greaterThan(1, 'Message content should be at least one byte');

          [
            "600", "201",
            "400", "202",
            "300", "203"
          ].forEach(str => {
            expect(stage4?.choices[0].message.content, `Should contain "${str}" in the response`).to.contain(str);
          });
        }, 5)
      });
    });
  }

  after(async function () {
    delete axios.defaults.headers.common['Accept-Encoding'];
    await clearAllKongResources();
  });
});
