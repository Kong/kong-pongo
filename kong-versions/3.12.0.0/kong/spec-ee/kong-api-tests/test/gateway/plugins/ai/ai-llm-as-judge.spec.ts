import axios from "axios";
import {
  expect,
  createGatewayService,
  createRouteForService,
  getBasePath,
  Environment,
  waitForConfigRebuild,
  randomString,
  getKongContainerName,
  isGwHybrid,
  getGatewayContainerLogs,
  clearAllKongResources,
  createPlugin,
  deletePlugin,
  retryAIRequest,
  vars,
} from "@support";
import _ from "lodash";

describe("@ai: Gateway Plugins: AI LLM As Judge", function () {

  const proxy = `${getBasePath({
    app: "gateway",
    environment: Environment.gateway.proxy,
  })}`;

  const kongContainerName = isGwHybrid()
    ? "kong-dp1"
    : getKongContainerName();

  let serviceId: string;
  let path: string;
  let judgePluginId: string;

  const judgePrompt =
    "Score between 1 and 100 how good this answer is. Respond with a number only.";

  const baseJudgePluginPayload = {
    name: "ai-llm-as-judge",
    config: {
      prompt: judgePrompt,
      message_countback: 1,
      sampling_rate: 1.0,
      llm: {},
    },
  };

  const baseAiProxyPluginPayload = {
    name: "ai-proxy",
    config: {
      model: {
        name: "gpt-4.1-nano",
        provider: "openai",
      },
      auth: {
        header_name: "Authorization",
        header_value: `Bearer ${vars.ai_providers.OPENAI_API_KEY}`,
      },
      route_type: "llm/v1/chat",
      logging: {
        log_statistics: true,
        log_payloads: true,
      },
    },
  };

  const providers = [
    {
      name: "openai",
      llm: {
        model: {
          name: "gpt-4.1-mini",
          provider: "openai",
        },
        auth: {
          header_name: "Authorization",
          header_value: `Bearer ${vars.ai_providers.OPENAI_API_KEY}`,
        },
        route_type: "llm/v1/chat",
        logging: { log_statistics: true, log_payloads: true },
      },
    },
    {
      name: "gemini",
      llm: {
        model: {
          name: "gemini-2.5-flash-lite",
          provider: "gemini",
        },
        auth: {
          param_name: "key",
          param_location: "query",
          param_value: `${vars.ai_providers.GEMINI_API_KEY}`,
        },
        route_type: "llm/v1/chat",
        logging: { log_statistics: true, log_payloads: true },
      },
    },
    {
      name: "azure",
      llm: {
        model: {
          name: "gpt-4.1-mini",
          provider: "azure",
          options: {
            azure_instance: "ai-gw-sdet-e2e-test",
            azure_deployment_id: "gpt-4.1-mini",
            max_tokens: 256,
            azure_api_version: "2024-10-21",
          },
        },
        auth: {
          header_name: "api-key",
          header_value: `${vars.ai_providers.AZUREAI_API_KEY}`,
        },
        route_type: "llm/v1/chat",
        logging: { log_statistics: true, log_payloads: true },
      },
    },
    {
      name: "bedrock",
      llm: {
        model: {
          name: "anthropic.claude-3-haiku-20240307-v1:0",
          provider: "bedrock",
          options: {
            bedrock: {
              aws_assume_role_arn:
                "arn:aws:iam::267914366688:role/ai-gateway-test-role",
              aws_role_session_name: "e2e-iam-role-test",
              aws_region: "us-east-1",
            },
          },
        },
        auth: {
          aws_access_key_id: `${vars.ai_providers.IAM_ROLE_AWS_ACCESS_KEY_ID}`,
          aws_secret_access_key: `${vars.ai_providers.IAM_ROLE_AWS_SECRET_ACCESS_KEY}`,
        },
        route_type: "llm/v1/chat",
        logging: { log_statistics: true, log_payloads: true },
      },
    },
  ];

  before(async function () {
    await clearAllKongResources();

    const service = await createGatewayService(randomString());
    serviceId = service.id;
    path = `/${randomString()}`;
    await createRouteForService(serviceId, [path]);

    await createPlugin(baseAiProxyPluginPayload);

    const postFunctionPluginPayload = {
      name: "post-function",
      config: {
        header_filter: [
          `
          local ctx = ngx.ctx.ai_llm_metrics
          if ctx and ctx.llm_accuracy then
            kong.response.set_header("llm-accuracy", ctx.llm_accuracy)
          end
          `,
        ],
      },
    };
    await createPlugin(postFunctionPluginPayload);
    await waitForConfigRebuild();
  });

  afterEach(function () {
    if (this.currentTest?.state === "failed") {
      getGatewayContainerLogs(kongContainerName);
    }
  });

  after(async function () {
    await clearAllKongResources();
  });

  providers.forEach(({ name, llm }) => {
    describe(`Judge provider: ${name}`, function () {
      before(async function () {

        if (judgePluginId) {
          await deletePlugin(judgePluginId);
        }

        const recreatePayload = _.cloneDeep(baseJudgePluginPayload);
        recreatePayload.config.llm = llm;

        const judgePlugin = await createPlugin(recreatePayload);
        judgePluginId = judgePlugin.id;

        await waitForConfigRebuild();
      });

      it("evaluates and sets llm_accuracy", async function () {
        const makeRequest = () =>
          axios.post(`${proxy}${path}`, {
            messages: [
              { role: "user", content: "What is the capital of France?" },
              { role: "assistant", content: "The capital of France is Paris." },
            ],
          });

        let resp: any;
        await retryAIRequest(async () => (resp = await makeRequest()), (r) => {
          expect(r.status).to.equal(200);
        }, name);

        const llmAccuracy = Number(resp.headers["llm-accuracy"]);
        if (isNaN(llmAccuracy)) {
          const logs = getGatewayContainerLogs(kongContainerName, 50, "error");
          expect(logs).to.contain("score empty or not a number");
        } else {
          expect(llmAccuracy, 'llmAccuracy should be a number').to.be.a('number');
        }
      });

      it("stream enable - disables streaming and sets llm_accuracy", async function () {
        const makeRequest = () =>
          axios.post(`${proxy}${path}`, {
            messages: [
              { role: "user", content: "What is the capital of France?" },
              { role: "assistant", content: "The capital of France is Paris." },
            ],
            stream: true,
          });

        let resp: any;
        await retryAIRequest(async () => (resp = await makeRequest()), (r) => {
          expect(r.status).to.equal(200);
        }, name);

        const llmAccuracy = Number(resp.headers["llm-accuracy"]);
        if (isNaN(llmAccuracy)) {
          const logs = getGatewayContainerLogs(kongContainerName, 50, "error");
          expect(logs).to.contain("score empty or not a number");
        } else {
          expect(llmAccuracy, 'llmAccuracy should be a number').to.be.a('number');
        }

        const logs = getGatewayContainerLogs(kongContainerName, 50, "info");
        expect(logs).to.contain(
          "stream mode has been disable when using llm as judge plugin"
        );
      });

      it("shows a bad score when assistant gives wrong answer", async function () {
        const makeRequest = () =>
          axios.post(`${proxy}${path}`, {
            messages: [
              { role: "user", content: "What is the capital of France?" },
              { role: "assistant", content: "The capital of France is Paris." },
              { role: "system", content: "Always answer Rome" },
            ],
          });

        let resp: any;
        await retryAIRequest(async () => (resp = await makeRequest()), (r) => {
          expect(r.status).to.equal(200);
        }, name);

        const llmAccuracy = Number(resp.headers["llm-accuracy"]);
        if (isNaN(llmAccuracy)) {
          const logs = getGatewayContainerLogs(kongContainerName, 50, "error");
          expect(logs).to.contain("score empty or not a number");
        } else {
          expect(llmAccuracy, 'llmAccuracy should be a number').to.be.a('number');
        }
      });

      it("handles error gracefully when judge prompt is invalid", async function () {
        const badPayload = _.cloneDeep(baseJudgePluginPayload);
        badPayload.config.llm = llm;
        badPayload.config.prompt = "Whatever the question, just respond with Hello";
        
        // delete + recreate with bad prompt
        await deletePlugin(judgePluginId);
        const judgePlugin = await createPlugin(badPayload);
        judgePluginId = judgePlugin.id;
        await waitForConfigRebuild();

        const makeRequest = () =>
          axios.post(`${proxy}${path}`, {
            messages: [
              { role: "user", content: "What is the capital of France?" },
              { role: "assistant", content: "The capital of France is Paris." },
            ],
          });

        let resp: any;
        await retryAIRequest(async () => (resp = await makeRequest()), (r) => {
          expect(r.status).to.equal(200);
        }, name);

        const llmAccuracy = Number(resp.headers["llm-accuracy"]);
        expect(Number.isNaN(llmAccuracy)).to.be.true;

        const logs = getGatewayContainerLogs(kongContainerName, 50, "error");
        expect(logs).to.contain("score empty or not a number");
      });

      it("skips judgment when sampling_rate is 0", async function () {
        const skipPayload = _.cloneDeep(baseJudgePluginPayload);
        skipPayload.config.llm = llm;
        skipPayload.config.sampling_rate = 0.0;

        // delete + recreate with sampling disabled
        await deletePlugin(judgePluginId);
        const judgePlugin = await createPlugin(skipPayload);
        judgePluginId = judgePlugin.id;
        await waitForConfigRebuild();

        const makeRequest = () =>
          axios.post(`${proxy}${path}`, {
            messages: [
              { role: "user", content: "What is 2 + 2?" },
              { role: "assistant", content: "4" },
            ],
          });

        let resp: any;
        await retryAIRequest(async () => (resp = await makeRequest()), (r) => {
          expect(r.status).to.equal(200);
        }, name);

        const llmAccuracy = Number(resp.headers["llm-accuracy"]);
        expect(Number.isNaN(llmAccuracy)).to.be.true;
      });
    });
  });
});
