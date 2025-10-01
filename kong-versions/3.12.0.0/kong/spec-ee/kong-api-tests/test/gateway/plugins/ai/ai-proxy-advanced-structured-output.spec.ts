import axios from 'axios';
import { logDebug } from '@support';
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
} from '@shared/ai_gateway_setups';
import {
  aiEventsToContent
} from '@shared/helpers';

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
      supportsArraySchema: false
    }
  },
  {
    provider: "anthropic",
    model: "claude-3-7-sonnet-20250219",
    settings: {
      apiKey: vars.ai_providers.ANTHROPIC_API_KEY,
      supportsArraySchema: false
    }
  },
  {
    provider: "azure",
    model: "gpt-4.1-mini",
    settings: {
      apiKey: vars.ai_providers.AZUREAI_API_KEY,
      supportsArraySchema: false,
      azureInstance: "ai-gw-sdet-e2e-test"
    }
  },
  // TODO: uncomment this when the stale Mistral API key issue is resolved
  // {
  //   provider: "mistral",
  //   model: "mistral-large-latest",
  //   settings: {
  //     apiKey: `Bearer ${vars.ai_providers.MISTRAL_API_KEY}`,
  //     maxTokens: 40000,
  //     supportsArraySchema: false
  //   }
  // },
  // FIXME
  //{
  //  provider: "gemini",
  //  model: "gemini-2.5-flash",
  //  settings: {
  //    serviceAccountJson: vars.ai_providers.VERTEX_API_KEY,
  //    locationId: "us-central1",
  //    apiEndpoint: "us-central1-aiplatform.googleapis.com",
  //    projectId: "gcp-sdet-test",
  //  }
  //},
  {
    provider: "gemini",
    model: "gemini-2.5-pro",
    settings: {
      serviceAccountJson: vars.ai_providers.VERTEX_API_KEY,
      locationId: "us-central1",
      apiEndpoint: "us-central1-aiplatform.googleapis.com",
      projectId: "gcp-sdet-test",
      maxTokens: 8192  // doesn't support long inference
    }
  },
  {
    provider: "gemini",
    model: "claude-3-7-sonnet",
    settings: {
      serviceAccountJson: `${vars.ai_providers.VERTEX_API_KEY}`,
      locationId: "us-east5", // us-central1 seems not usable?
      apiEndpoint: "us-east5-aiplatform.googleapis.com",
      projectId: "gcp-sdet-test",
      maxTokens: 32000,
      anthropicVersion: "vertex-2023-10-16",  // doesn't look like this is ever used or updated by Google?
      supportsArraySchema: false
    }
  },
  // FIXME
  //{
  //  provider: "bedrock",
  //  model: "amazon.nova-lite-v1:0",
  //  settings: {
  //    awsAccessKeyId: `${vars.aws.AWS_ACCESS_KEY_ID}`,
  //    awsSecretAccessKey: `${vars.aws.AWS_SECRET_ACCESS_KEY}`,
  //    supportsArraySchema: false
  //  }
  //},
  {
    provider: "bedrock",
    model: "us.anthropic.claude-sonnet-4-20250514-v1:0",
    settings: {
      awsAccessKeyId: vars.aws.AWS_ACCESS_KEY_ID,
      awsSecretAccessKey: vars.aws.AWS_SECRET_ACCESS_KEY,
      supportsArraySchema: false
    }
  }
];

const SETUP_MESSAGES = {
  MATHEMATICIAN: {
    SYSTEM: {
      "role": "system",
      "content": "You are a helpful math tutor."
    },
    USER: {
      "role": "user",
      "content": "solve 8x + 31 = 2\n\nMake sure your final answer starts 'x = ' and then answer. Solve in less than 3 steps."
    }
  },
  CHEF: {
    SYSTEM: {
      "role": "system",
      "content": "You are a helpful chef."
    },
    USER: {
      "role": "user",
      "content": "List three popular cookie recipes, and include the amounts of three major ingredients."
    }
  },
  DATA_ANALYST: {
    SYSTEM: {
      "role": "system",
      "content": "\n### TASK ###\nYou are a highly skilled data analyst. Your goal is to examine the provided database schema, interpret the posed question, and identify the specific columns from the relevant tables required to construct an accurate SQL query.\n\nThe database schema includes tables, columns, primary keys, foreign keys, relationships, and any relevant constraints.\n\n### INSTRUCTIONS ###\n1. Carefully analyze the schema and identify the essential tables and columns needed to answer the question.\n2. For each table, provide a clear and concise reasoning for why specific columns are selected.\n3. List each reason as part of a step-by-step chain of thought, justifying the inclusion of each column.\n4. If a \".\" is included in columns, put the name before the first dot into chosen columns.\n5. The number of columns chosen must match the number of reasoning.\n6. Final chosen columns must be only column names, don't prefix it with table names.\n7. If the chosen column is a child column of a STRUCT type column, choose the parent column instead of the child column.\n\n### FINAL ANSWER FORMAT ###\nPlease provide your response as a JSON object, structured as follows:\n\n{\n \"results\": [\n {\n \"table_selection_reason\": \"Reason for selecting tablename1\",\n \"table_contents\": {\n \"chain_of_thought_reasoning\": [\n \"Reason 1 for selecting column1\",\n \"Reason 2 for selecting column2\",\n ...\n ],\n \"columns\": [\"column1\", \"column2\", ...]\n },\n \"table_name\":\"tablename1\",\n },\n {\n \"table_selection_reason\": \"Reason for selecting tablename2\",\n \"table_contents\":\n {\n \"chain_of_thought_reasoning\": [\n \"Reason 1 for selecting column1\",\n \"Reason 2 for selecting column2\",\n ...\n ],\n \"columns\": [\"column1\", \"column2\", ...]\n },\n \"table_name\":\"tablename2\"\n },\n ...\n ]\n}\n\n### ADDITIONAL NOTES ###\n- Each table key must list only the columns relevant to answering the question.\n- Provide a reasoning list (`chain_of_thought_reasoning`) for each table, explaining why each column is necessary.\n- Provide the reason of selecting the table in (`table_selection_reason`) for each table.\n- Be logical, concise, and ensure the output strictly follows the required JSON format.\n- Use table name used in the \"Create Table\" statement, don't use \"alias\".\n- Match Column names with the definition in the \"Create Table\" statement.\n- Match Table names with the definition in the \"Create Table\" statement.\n\nGood luck!\n\n"
    },
    USER: {
      "role": "user",
      "content": "\n### Database Schema ###\n\n\n \n/* {'alias': 'public.services', 'description': ''} */\nCREATE TABLE public_services (\n -- {\"alias\":\"id\",\"description\":\"\"}\n id UUID,\n -- {\"alias\":\"created_at\",\"description\":\"\"}\n created_at TIMESTAMPTZ,\n -- {\"alias\":\"updated_at\",\"description\":\"\"}\n updated_at TIMESTAMPTZ,\n -- {\"alias\":\"name\",\"description\":\"\"}\n name TEXT,\n -- {\"alias\":\"retries\",\"description\":\"\"}\n retries BIGINT,\n -- {\"alias\":\"protocol\",\"description\":\"\"}\n protocol TEXT,\n -- {\"alias\":\"host\",\"description\":\"\"}\n host TEXT,\n -- {\"alias\":\"port\",\"description\":\"\"}\n port BIGINT,\n -- {\"alias\":\"path\",\"description\":\"\"}\n path TEXT,\n -- {\"alias\":\"connect_timeout\",\"description\":\"\"}\n connect_timeout BIGINT,\n -- {\"alias\":\"write_timeout\",\"description\":\"\"}\n write_timeout BIGINT,\n -- {\"alias\":\"read_timeout\",\"description\":\"\"}\n read_timeout BIGINT,\n -- {\"alias\":\"tags\",\"description\":\"\"}\n tags UNKNOWN,\n -- {\"alias\":\"client_certificate_id\",\"description\":\"\"}\n client_certificate_id UUID,\n -- {\"alias\":\"tls_verify\",\"description\":\"\"}\n tls_verify BOOL,\n -- {\"alias\":\"tls_verify_depth\",\"description\":\"\"}\n tls_verify_depth SMALLINT,\n -- {\"alias\":\"ca_certificates\",\"description\":\"\"}\n ca_certificates UNKNOWN,\n -- {\"alias\":\"ws_id\",\"description\":\"\"}\n ws_id UUID,\n -- {\"alias\":\"enabled\",\"description\":\"\"}\n enabled BOOL,\n -- {\"alias\":\"tls_sans\",\"description\":\"\"}\n tls_sans UNKNOWN,\n -- {\"condition\": \"public_routes\".service_id = \"public_services\".id, \"joinType\": ONE_TO_MANY}\n FOREIGN KEY (id) REFERENCES public_routes()\n);\n\n\n### INPUT ###\n\nWhat are the most frequently used routes in the system?"
    }
  }
};

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

describe("@ai: Gateway Plugins: AI Proxy Advanced Structured Output", function () {
  const basePath = "/ai_proxy_advanced_structured_output_spec";

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
            connect_timeout: 600000,
            read_timeout: 600000,
            write_timeout: 600000,
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
  
  for (const test of tests) {
    const testIdentifier = `${test.provider}_${test.model}`;
    const path = `/${basePath}/${testIdentifier}`;

    const proxyUrl = getBasePath({
      environment: isGateway() ? Environment.gateway.proxy : undefined,
    });

    const makeStructuredOutputRequestObjectRoot = async (
      proxyUrl: string,
      path: string,
      isStream = false
    ): Promise<string | any[] | undefined> => {

      const jsonBody = {
        "messages": [
          SETUP_MESSAGES.MATHEMATICIAN.SYSTEM,
          SETUP_MESSAGES.MATHEMATICIAN.USER
        ],
        "response_format": {
          "type": "json_schema",
          "json_schema": {
            "name": "math_response",
            "strict": true,
            "schema": {
              "type": "object",
              "properties": {
                "steps": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "explanation": {
                        "type": "string"
                      },
                      "output": {
                        "type": "string"
                      }
                    },
                    "required": ["explanation", "output"],
                    "additionalProperties": false
                  }
                },
                "final_answer": {
                  "type": "string"
                }
              },
              "required": ["steps", "final_answer"],
              "additionalProperties": false
            }
          }
        },
        "stream": isStream
      };

      // Some Bedrock models still don't support system prompts
      if (('removeSystemPrompt' in test.settings && test.settings.removeSystemPrompt)) {
        jsonBody.messages = jsonBody.messages.filter(m => m.role !== 'system');
      }

      if (isStream) {
        const events_o: any[] = [];

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

    // Some LLM don't support this
    const makeStructuredOutputRequestArrayRoot = async (
      proxyUrl: string,
      path: string,
      isStream = false
    ): Promise<string | any[] | undefined> => {

      const jsonBody = {
        "messages": [
          SETUP_MESSAGES.CHEF.SYSTEM,
          SETUP_MESSAGES.CHEF.USER
        ],
        "response_format": {
          "type": "json_schema",
          "json_schema": {
            "name": "recipes",
            "strict": true,
            "schema": {
              "additionalProperties": false,
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "recipeName": { "type": "string" },
                  "ingredients": {
                    "type": "array",
                    "items": { "type": "string" }
                  }
                },
                "additionalProperties": false,
                "propertyOrdering": ["recipeName", "ingredients"]
              }
            }
          }
        },
        "stream": isStream
      };

      // Some Bedrock models still don't support system prompts
      if (('removeSystemPrompt' in test.settings && test.settings.removeSystemPrompt)) {
        jsonBody.messages = jsonBody.messages.filter(m => m.role !== 'system');
      }

      if (isStream) {
        const events_o: any[] = [];

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

    const makeStructuredOutputRequestComplexSchema = async (
      proxyUrl: string,
      path: string,
      isStream = false
    ): Promise<string | any[] | undefined> => {

      const jsonBody = {
        "messages": [
          SETUP_MESSAGES.DATA_ANALYST.SYSTEM,
          SETUP_MESSAGES.DATA_ANALYST.USER
        ],
        "n": 1,
        "response_format": {
          "type": "json_schema",
          "json_schema": {
            "name": "retrieval_schema",
            "schema": {
              "$defs": {
                "MatchingTable": {
                  "properties": {
                    "table_name": {
                      "title": "Table Name",
                      "type": "string"
                    },
                    "table_contents": {
                      "$ref": "#/$defs/MatchingTableContents"
                    },
                    "table_selection_reason": {
                      "title": "Table Selection Reason",
                      "type": "string"
                    }
                  },
                  "required": [
                    "table_name",
                    "table_contents",
                    "table_selection_reason"
                  ],
                  "title": "MatchingTable",
                  "type": "object"
                },
                "MatchingTableContents": {
                  "properties": {
                    "chain_of_thought_reasoning": {
                      "items": {
                        "type": "string"
                      },
                      "title": "Chain Of Thought Reasoning",
                      "type": "array"
                    },
                    "columns": {
                      "items": {
                        "type": "string"
                      },
                      "title": "Columns",
                      "type": "array"
                    }
                  },
                  "required": [
                    "chain_of_thought_reasoning",
                    "columns"
                  ],
                  "title": "MatchingTableContents",
                  "type": "object"
                }
              },
              "properties": {
                "results": {
                  "items": {
                    "$ref": "#/$defs/MatchingTable"
                  },
                  "title": "Results",
                  "type": "array"
                }
              },
              "required": [
                "results"
              ],
              "title": "RetrievalResults",
              "type": "object"
            }
          }
        },
        "seed": 0,
        "temperature": 0,
        "stream": isStream
      };

      // Some Bedrock models still don't support system prompts
      if (('removeSystemPrompt' in test.settings && test.settings.removeSystemPrompt)) {
        jsonBody.messages = jsonBody.messages.filter(m => m.role !== 'system');
      }

      if (isStream) {
        const events_o: any[] = [];

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

    const makeStructuredOutputRequestContainsEmptyArray = async (
      proxyUrl: string,
      path: string,
      isStream = false
    ): Promise<string | any[] | undefined> => {

      const jsonBody = {
        "messages": [
          {
            "role": "user",
            "content": "Generate an empty array wrapped in an object"
          }
        ],
        "response_format": {
          "type": "json_schema",
          "json_schema": {
            "name": "empty",
            "strict": true,
            "schema": {
              "type": "object",
              "properties": {
                "empty_array": {
                  "type": "array",
                  "items": {
                    "type": "string"
                  }
                }
              },
              "required": ["empty_array"],
              "additionalProperties": false
            }
          }
        },
        "stream": isStream
      };

      // Some Bedrock models still don't support system prompts
      if (('removeSystemPrompt' in test.settings && test.settings.removeSystemPrompt)) {
        jsonBody.messages = jsonBody.messages.filter(m => m.role !== 'system');
      }

      if (isStream) {
        const events_o: any[] = [];

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
    }

    describe(`${test.provider} (${test.model}) [text/event-stream]`, function () {
      it('structured output with object type root', async function () {
        await withRetry(async () => {
          const events = await makeStructuredOutputRequestObjectRoot(proxyUrl, path, true);
          const content = aiEventsToContent(events);

          // Implicitly testing it's JSON by decode attempt
          const structuredOutput = JSON.parse(content || 'not-json');
          expect(structuredOutput).to.have.property('steps').that.is.an('array').that.is.not.empty;
          expect(structuredOutput).to.have.property('final_answer').that.is.a('string').that.is.not.empty;
        }, test.model === 'amazon.nova-lite-v1:0' ? 5 : 1);
      });

      it('structured output with array type root', async function () {
        if ('supportsArraySchema' in test.settings && test.settings.supportsArraySchema === false) {
          console.log("Array-at-root schema is not supported for this model");
          this.skip();
        }

        await withRetry(async () => {
          const events = await makeStructuredOutputRequestArrayRoot(proxyUrl, path, true);
          const content = aiEventsToContent(events);

          // Implicitly testing it's JSON by decode attempt
          const structuredOutput = JSON.parse(content || 'not-json');

          for (const recipe of structuredOutput) {
            expect(recipe).to.have.property('recipeName').that.is.a('string').that.is.not.empty;
            expect(recipe).to.have.property('ingredients').that.is.an('array').that.is.not.empty;
          }
        }, test.model === 'amazon.nova-lite-v1:0' ? 5 : 1)
      });

      it('structured output with extreme complex schema', async function () {
        if ('supportsComplexSchema' in test.settings && test.settings.supportsComplexSchema === false) {
          console.log("Complex schema is not supported for this model");
          this.skip();
        }

        await withRetry(async () => {
          const events = await makeStructuredOutputRequestComplexSchema(proxyUrl, path, true);
          const content = aiEventsToContent(events);

          // Implicitly testing it's JSON by decode attempt
          const structuredOutput = JSON.parse(content || 'not-json');

          expect(structuredOutput).to.have.property('results').that.is.an('array').that.is.not.empty;

          for (const result of structuredOutput.results) {
            expect(result).to.have.property('table_selection_reason').that.is.a('string').that.is.not.empty;
            expect(result).to.have.property('table_name').that.is.a('string').that.is.not.empty;
            expect(result.table_contents).to.have.property('columns').that.is.an('array').that.is.not.empty;
            expect(result.table_contents).to.have.property('chain_of_thought_reasoning').that.is.an('array').that.is.not.empty;
          }
        }, test.model === 'amazon.nova-lite-v1:0' ? 5 : 1)
      });

      it('structured output with empty array', async function () {
        await withRetry(async () => {
          const events = await makeStructuredOutputRequestContainsEmptyArray(proxyUrl, path, true);
          const content = aiEventsToContent(events);

          // Implicitly testing it's JSON by decode attempt
          const structuredOutput = JSON.parse(content || 'not-json');

          expect(structuredOutput).to.have.property('empty_array').that.is.an('array');
        }, test.model === 'amazon.nova-lite-v1:0' ? 5 : 2)
      });
    });

    describe(`${test.provider} (${test.model}) [application/json]`, function () {
      it('structured output with object type root', async function () {
        await withRetry(async () => {
          const resRaw = await makeStructuredOutputRequestObjectRoot(proxyUrl, path, false);
          const res = typeof resRaw === 'string' ? JSON.parse(resRaw) : resRaw;

          expect(res.choices).to.have.lengthOf(1, 'Should have one message candidate in the response');
          expect(res?.choices[0]?.message?.content || '').is.lengthOf.greaterThan(0, 'Should have message response textual content');

          // Implicitly testing it's JSON by decode attempt
          const structuredOutput = JSON.parse(res?.choices[0]?.message?.content || 'not-json');
          expect(structuredOutput).to.have.property('steps').that.is.an('array').that.is.not.empty;
          expect(structuredOutput).to.have.property('final_answer').that.is.a('string').that.is.not.empty;
        }, test.model === 'amazon.nova-lite-v1:0' ? 5 : 1)
      });

      it('structured output with array type root', async function () {
        if ('supportsArraySchema' in test.settings && test.settings.supportsArraySchema === false) {
          console.log("Array-at-root schema is not supported for this model");
          this.skip();
        }

        await withRetry(async () => {
          const resRaw = await makeStructuredOutputRequestArrayRoot(proxyUrl, path, false);
          const res = typeof resRaw === 'string' ? JSON.parse(resRaw) : resRaw;

          expect(res.choices).to.have.lengthOf(1, 'Should have one message candidate in the response');
          expect(res?.choices[0]?.message?.content || '').is.lengthOf.greaterThan(0, 'Should have message response textual content');;

          // Implicitly testing it's JSON by decode attempt
          const structuredOutput = JSON.parse(res?.choices[0]?.message?.content || 'not-json');
          expect(structuredOutput).to.be.an('array').that.is.not.empty;
          expect(structuredOutput).to.have.lengthOf.at.least(2, 'Should have at least two recipes in the response');

          for (const recipe of structuredOutput) {
            expect(recipe).to.have.property('recipeName').that.is.a('string').that.is.not.empty;
            expect(recipe).to.have.property('ingredients').that.is.an('array').that.is.not.empty;
          }
        }, test.model === 'amazon.nova-lite-v1:0' ? 5 : 1)
      });

      it('structured output with extreme complex schema', async function () {
        if ('supportsComplexSchema' in test.settings && test.settings.supportsComplexSchema === false) {
          console.log("Complex schema is not supported for this model");
          this.skip();
        }

        await withRetry(async () => {
          const resRaw = await makeStructuredOutputRequestComplexSchema(proxyUrl, path, false);
          const res = typeof resRaw === 'string' ? JSON.parse(resRaw) : resRaw;

          expect(res.choices).to.have.lengthOf(1, 'Should have one message candidate in the response');
          expect(res?.choices[0]?.message?.content || '').is.lengthOf.greaterThan(0, 'Should have message response textual content');

          // Implicitly testing it's JSON by decode attempt
          const structuredOutput = JSON.parse(res?.choices[0]?.message?.content || 'not-json');

          expect(structuredOutput).to.have.property('results').that.is.an('array').that.is.not.empty;

          for (const result of structuredOutput.results) {
            expect(result).to.have.property('table_selection_reason').that.is.a('string').that.is.not.empty;
            expect(result).to.have.property('table_name').that.is.a('string').that.is.not.empty;
            expect(result.table_contents).to.have.property('columns').that.is.an('array').that.is.not.empty;
            expect(result.table_contents).to.have.property('chain_of_thought_reasoning').that.is.an('array').that.is.not.empty;
          }
        }, test.model === 'amazon.nova-lite-v1:0' ? 5 : 1)
      });

      it('structured output with empty array', async function () {
        await withRetry(async () => {
          const resRaw = await makeStructuredOutputRequestContainsEmptyArray(proxyUrl, path, false);
          const res = typeof resRaw === 'string' ? JSON.parse(resRaw) : resRaw;

          expect(res.choices).to.have.lengthOf(1, 'Should have one message candidate in the response');
          expect(res?.choices[0]?.message?.content || '').is.lengthOf.greaterThan(0, 'Should have message response textual content');;

          // Implicitly testing it's JSON by decode attempt
          const structuredOutput = JSON.parse(res?.choices[0]?.message?.content || 'not-json');
          expect(structuredOutput).to.be.an('object');
          expect(structuredOutput).to.have.property('empty_array').that.is.an('array');
        }, test.model === 'amazon.nova-lite-v1:0' ? 5 : 2) // add retry to avoid occasional 5xx failure
      });
    });
  }

  after(async function () {
    delete axios.defaults.headers.common['Accept-Encoding'];
    await clearAllKongResources();
  });
});
